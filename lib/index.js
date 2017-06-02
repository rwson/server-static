#!/usr/bin/env node

require("console.table");

var fs = require("fs"),
    path = require("path"),
    http = require("http"),
    colorConsole = require("color-console"),
    minimist = require("minimist"),
    chokidar = require("chokidar"),
    open = require("open"),
    detect = require("detect-port"),
    connect = require("connect"),
    log4js = require("log4js"),
    connectRouter = require("connect-route"),
    bodyParser = require("body-parser"),
    serveStatic = require("serve-static"),
    socket = require("socket.io"),
    inject = require("inject-html"),
    proxy = require("http-proxy-middleware"),
    minimist = require("minimist"),
    argv = minimist(process.argv.slice(2), {
        alias: {
            h: "help",
            p: "port",
            d: "dir",
            s: "slient"
        }
    }),
    dir = argv.d ? argv.d : process.cwd(),
    port = argv.p,
    slient = argv.s,
    logger = log4js.getLogger();

var cfgFile = path.join(dir, "static-server.config.js");

//  帮助文档
var helps = [{
    name: "entry",
    valueType: "String",
    defaultVal: "index.html",
    mean: "index page file name"
}, {}, {
    name: "port",
    valueType: "Number",
    defaultVal: 3000,
    mean: "port will listen"
}, {}, {
    name: "ignores",
    valueType: "Array.<Function>/Function",
    defaultVal: "useless files",
    mean: "ignore files"
}, {}, {
    name: "slient",
    valueType: "Boolean",
    defaultVal: "false",
    mean: "not reload page/css when file changed"
}, {}, {
    name: "routers",
    valueType: "Array.<Object>/Object",
    defaultVal: "[]",
    mean: "custom routes, mock data etc."
}, {}, {
    name: "target",
    valueType: "String",
    defaultVal: "N/A",
    mean: "ajax proxy url's url & context"
}];

var helpsCmd = [{
    name: "port",
    valueType: "Number",
    defaultVal: "3000",
    mean: "port will listen"
}, {}, {
    name: "dir",
    valueType: "String",
    defaultVal: "current directory",
    mean: "work directory"
}, {}, {
    name: "slient",
    valueType: "Boolean",
    defaultVal: "false",
    mean: "not reload page or css when file changed"
}];

var app = connect(),
    cfg = {
        entry: "index.html",
        port: port || 3000,
        watches: dir,
        ignores: undefined,
        routers: []
    },
    ignores = [
        function(path) {
            return /node_modules|jspm_packages|bower_components|^\.[\S\s]+/.test(path);
        }
    ],
    injectScript = inject({
        code: `
            <!--injected by static-server-->
            <script src="http://cdn.bootcss.com/socket.io/1.7.2/socket.io.min.js"></script>
            <script type="text/javascript">
                var socket = io.connect("/"),
                    doc = document,
                    head = doc.getElementsByTagName("head")[0],
                    links, cur, link, parent;
                socket.on("refresh-css", function() {
                    links = document.getElementsByTagName("link");
                    for(var i = 0, len = links.length; i < len; i ++) {
                        cur = links[i];
                        parent = cur.parentNode;
                        if (parent === null) {
                            parent = head;
                        }
                        if (cur.rel === "stylesheet" && cur.href.length) {
                            link = doc.createElement("link");
                            link.rel = "stylesheet";
                            link.href = cur.href + "?v=" + (new Date()).getTime();
                            parent.replaceChild(link, cur);
                        }
                    }
                });
                socket.on("refresh-page", function() {
                    location.reload();
                });
            </script>
            <!--injected by static-server end-->
        `
    }),
    outConfig, router, target;

//  帮助
if (argv.h) {
    console.log("\n");
    colorConsole.red("use config file:");
    console.table(helps);

    console.log("\n");
    colorConsole.red("command line arguments:");
    console.table(helpsCmd);

    process.exit();
}

//  读取配置文件
try {
    outConfig = require(cfgFile);
    target = outConfig.target;
    if (Array.isArray(outConfig.routers) && outConfig.routers.length) {
        for (var i = 0, len = outConfig.routers.length; i < len; i++) {
            router = outConfig.routers[i];
            if (typeof router.url === "undefined") {
                throw `you must specific in the router config item, you specified: ${JSON.stringify(router)}`;
            }
            if (!router.cross) {
                if (typeof router.handler !== "function") {
                    throw `router handler must be a function in the router config item, you specified: ${JSON.stringify(router)}`;
                }
                router.method = router.method || "get";
            } else {
                if (!target) {
                    throw `you must specific in the target when you want to use cross origin requests`;
                }
            }
        }
    }
    if (typeof outConfig.slient !== "undefined") {
        slient = outConfig.slient;
    }
    cfg = merge(cfg, outConfig);
} catch (e) {
    if (e && e.code !== "MODULE_NOT_FOUND") {
        throw e;
    }
}

cfg.ignores = ignores;
cfg.slient = toBoolean(slient);

//  检测端口是否可用
detect(cfg.port, function(ex, _port) {
    if (cfg.port === _port) {
        logger.info(`static-server will listen at ${_port}`);
    } else {
        logger.warn(`${cfg.port} was listened, will listen at ${_port}`);
        cfg.port = _port;
    }

    //  启服务
    statrServer(cfg);
});

/**
 * 启动服务
 * @param   cfg     配置项
 */
function statrServer(cfg) {
    var url = `http://127.0.0.1:${cfg.port}`,
        pathInfo, htmlStream, server, io;
    app.use(function(req, res, next) {
            res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
            res.setHeader("Allow", "GET,PUT,POST,DELETE");
            res.setHeader("charset", "utf-8");

            pathInfo = req.url;

            //  处理完整HTML格式的
            if (pathInfo === "/" || /\.html?/.test(pathInfo)) {
                //  处理"/"的情况
                if (pathInfo === "/") {
                    pathInfo = cfg.entry;
                }
                try {
                    pathInfo = path.join(dir, pathInfo);
                    htmlStream = fs.readFileSync(pathInfo, {
                        encoding: "utf8",
                        flag: "r"
                    });
                    if (isFullyHtml(htmlStream) && !cfg.slient) {
                        injectScript(req, res, function() {
                            res.setHeader("Content-Type", "text/html; charset=utf-8");
                            res.statusCode = 200;
                            res.end(htmlStream);
                        });
                    } else {
                        next();
                    }
                } catch (e) {
                    next();
                }
            } else {
                next();
            }
        })
        .use(bodyParser.urlencoded({
            extended: false
        }))
        .use(serveStatic(dir, {
            "index": [cfg.entry ? cfg.entry : "index.html"]
        }))
        .use(connectRouter(function(route) {
            if (Array.isArray(cfg.routers) && cfg.routers.length) {
                cfg.routers.forEach(function(routerItem) {
                    if (!routerItem.cross) {
                        route[routerItem.method.toLowerCase()](routerItem.url, routerItem.handler);
                    } else {
                        route[routerItem.method.toLowerCase()](routerItem.url, proxy({
                            target: target,
                            changeOrigin: true
                        }));
                    }
                });
            } else if (typeOf(cfg.routers) === "object") {
                if (!cfg.routers.cross) {
                    route[cfg.routers.method.toLowerCase()](cfg.routers.url, cfg.routers.handler);
                }
            }
        }));

    //  routers全跨域
    if(typeOf(cfg.routers) === "object" && cfg.routers.cross) {
        app.use(proxy({
            target: target, changeOrigin: true
        }));
    }

    //  监听相关端口启动服务
    server = http.createServer(app).listen(cfg.port, function(req, res) {
        open(url);
    });

    //  不监听文件变化
    if (cfg.slient) {
        return;
    }

    io = socket.listen(server);
    io.on("connect", function(socket) {
        const watcher = chokidar.watch(cfg.watches, {
            ignored: cfg.ignores,
            ignoreInitial: true
        });
        watcher.on("change", (file) => {
                handleChange(cfg, file, io);
            })
            .on("add", (file) => {
                handleChange(cfg, file, io);
            })
            .on("unlink", (file) => {
                handleChange(cfg, file, io);
            })
            .on("addDir", (file) => {
                handleChange(cfg, file, io);
            })
            .on("unlinkDir", (file) => {
                handleChange(cfg, file, io);
            })
            .on("ready", function() {
                logger.info("detecting file changes...");
            });
    });
}

/**
 * 文件发生变化回调
 * @param    {Object}   cfg
 * @param    {String}   file
 * @param    {Object}   io
 */
function handleChange(cfg, file, io) {
    file = path.basename(file);
    if (/\.css$/.test(file)) {
        logger.info(`${file} changed, reload css...`);
        io.emit("refresh-css");
    } else {
        logger.info(`${file} changed, refresh page...`);
        io.emit("refresh-page");
    }
}

/**
 * 合并对象
 * @param obj1
 * @param obj2
 * @returns {object}
 */
function merge(obj1, obj2) {
    for (var i in obj2) {
        obj1[i] = obj2[i];
    }
    return obj1;
}

/**
 * 判断字符串是否为完整的HTML字符串(<!doctype ...>开头, 包含html、head/body)
 * @param    {String}   str     被判断的字符串
 * @return   {Boolean}
 */
function isFullyHtml(str) {
    if (!str && str.length === 0) {
        return false;
    }
    str = str.replace(/\t|\n/g, "").trim();
    return (/^\<\!doctype/i).test(str) &&
        (/<html\b[^>]*>/gi).test(str) && (/<\/html\b[^>]*>/gi).test(str) &&
        ((/<head\b[^>]*>/gi).test(str) && (/<\/head\b[^>]*>/gi).test(str) ||
            (/<body\b[^>]*>/gi).test(str) && (/<\/body\b[^>]*>/gi).test(str));
}

/**
 * 将值转换成布尔类型
 * @param    {any}   value    将要被转换的版本
 * @return   {Boolean}
 */
function toBoolean(value) {
    return !!(value);
}

/**
 * 获取对象的类名
 * @param    {any}   obj
 * @return   {String}
 */
function typeOf(obj) {
    return {}.toString.call(obj).slice(8, -1).toLowerCase();
}