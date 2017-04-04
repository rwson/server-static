# static-server

静态文件服务器,支持SPA,类似于[live-server](https://github.com/tapio/live-server),支持自定义ajax请求路径mock数据,支持模拟ajax跨域请求进行接口调试

### 安装

    npm install server-static -g

安装完成可通过运行

    static-server --help
    
命令查看配置帮助文档

通过在项目目录下运行

    static-server

的方式启动本服务


### 配置(如不指定,就用默认配置)

可以通过在项目根目录下新建名为"static-server.config.js"的文件进行配置

    //  static-server.config.js

    module.exports = {
    	port: 4000,                         // 监听端口,默认3000,当端口被占用时随机
    	entry: "index.html",                // 首页文件,及当路径为"/"时响应的页面 
        target: "http://localhost:8080",    // 调试ajax接口的真实地址和前缀
    	ignores: [                          //  忽略过滤器(可传入单个函数或者由函数组成的数组)
    		function(file) {
    		    return /node_modules/.test(file);
    		}
    	],
    	routers: [                          //  自定义请求路由
    	    {
    	        url: "/login",              //  请求的真实地址
    	        method: "GET",
    	        cross: true                 //  是否跨域请求
    	    },
    		{
    			url: "/main",                       //  路由
    			method: "GET",                      //  请求方式
    			handler: function(req, res, next) { //  改路由的处理函数(与connect模块调用方法一致)
    				console.log("请求进来了");
    				res.statusCode = 200;
    				res.end(JSON.stringify({
    					res: "test main"
    				}));
    			}
    		},
    		{
    			url: "/main2",
    			method: "POST",
    			handler: function(req, res, next) {
    				console.log(req.body);
    				res.statusCode = 200;
    				res.end(JSON.stringify({
    					tip: "请求内容",
    					res: req.body
    				}));
    			}
    		}
    	]
    };
    
