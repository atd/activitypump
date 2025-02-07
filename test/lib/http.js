// http.js
//
// HTTP utilities for testing
//
// Copyright 2012, StatusNet Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var http = require("http"),
    assert = require("assert"),
    querystring = require("querystring"),
    _ = require("underscore"),
    OAuth = require("oauth").OAuth,
    urlparse = require("url").parse;

var OAuthJSONError = function(obj) {
    Error.captureStackTrace(this, OAuthJSONError);
    this.name = "OAuthJSONError";  
    _.extend(this, obj);
};

OAuthJSONError.prototype = new Error();  
OAuthJSONError.prototype.constructor = OAuthJSONError;

OAuthJSONError.prototype.toString = function() {
    return "OAuthJSONError (" + this.statusCode + "): " + this.data;
};

var newOAuth = function(serverURL, cred) {
    var oa, parts;

    parts = urlparse(serverURL);

    oa = new OAuth("http://"+parts.host+"/oauth/request_token",
                   "http://"+parts.host+"/oauth/access_token",
                   cred.consumer_key,
                   cred.consumer_secret,
                   "1.0",
                   null,
                   "HMAC-SHA1",
                   null, // nonce size; use default
                   {"User-Agent": "activitypump-test/0.1.0"});

    return oa;
};

var endpoint = function(url, hostname, port, methods) {

    if (!port) {
        methods = hostname;
        hostname = "localhost";
        port = 4815;
    } else if (!methods) {
        methods = port;
        port = 80;
    }

    var context = {
        topic: function() {
            options(hostname, port, url, this.callback);
        },
        "it exists": function(err, allow, res, body) {
            assert.ifError(err);
            assert.equal(res.statusCode, 200);
        }
    };

    var checkMethod = function(method) {
        return function(err, allow, res, body) {
            assert.include(allow, method);
        };
    };
    var i;

    for (i = 0; i < methods.length; i++) {
        context["it supports "+methods[i]] = checkMethod(methods[i]);
    }

    return context;
};

var options = function(host, port, path, callback) {

    var reqOpts = {
        host: host,
        port: port,
        path: path,
        method: "OPTIONS",
        headers: {
            "User-Agent": "activitypump-test/0.1.0dev"
        }
    };

    var req = http.request(reqOpts, function(res) {
        var body = "";
        res.setEncoding("utf8");
        res.on("data", function(chunk) {
            body = body + chunk;
        });
        res.on("error", function(err) {
            callback(err, null, null, null);
        });
        res.on("end", function() {
            var allow = [];
            if (_(res.headers).has("allow")) {
                allow = res.headers.allow.split(",").map(function(s) { return s.trim(); });
            }
            callback(null, allow, res, body);
        });
    });

    req.on("error", function(err) {
        callback(err, null, null, null);
    });

    req.end();
};

var post = function(host, port, path, params, callback) {

    var requestBody = querystring.stringify(params);

    var reqOpts = {
        host: host,
        port: port,
        path: path,
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": requestBody.length,
            "User-Agent": "activitypump-test/0.1.0dev"
        }
    };

    var req = http.request(reqOpts, function(res) {
        var body = "";
        res.setEncoding("utf8");
        res.on("data", function(chunk) {
            body = body + chunk;
        });
        res.on("error", function(err) {
            callback(err, null, null);
        });
        res.on("end", function() {
            callback(null, res, body);
        });
    });

    req.on("error", function(err) {
        callback(err, null, null);
    });

    req.write(requestBody);

    req.end();
};

var jsonHandler = function(callback) {
    return function(err, data, response) {
        var obj;
        if (err) {
            callback(new OAuthJSONError(err), null, null);
        } else {
            try {
                obj = JSON.parse(data);
                callback(null, obj, response);
            } catch (e) {
                callback(e, null, null);
            }
        }
    };
};

var postJSON = function(serverUrl, cred, payload, callback) {

    var oa, toSend;

    oa = newOAuth(serverUrl, cred);
    
    toSend = JSON.stringify(payload);

    oa.post(serverUrl, cred.token, cred.token_secret, toSend, "application/json", jsonHandler(callback));
};

var putJSON = function(serverUrl, cred, payload, callback) {

    var oa, toSend;

    oa = newOAuth(serverUrl, cred);
    
    toSend = JSON.stringify(payload);

    oa.put(serverUrl, cred.token, cred.token_secret, toSend, "application/json", jsonHandler(callback));
};

var getJSON = function(serverUrl, cred, callback) {

    var oa, toSend;

    oa = newOAuth(serverUrl, cred);
    
    oa.get(serverUrl, cred.token, cred.token_secret, jsonHandler(callback));
};

var delJSON = function(serverUrl, cred, callback) {

    var oa, toSend;

    oa = newOAuth(serverUrl, cred);
    
    oa["delete"](serverUrl, cred.token, cred.token_secret, jsonHandler(callback));
};

var getfail = function(rel, status) {
    if (!status) {
        status = 400;
    }
    return {
        topic: function() {
            var callback = this.callback;
            http.get("http://localhost:4815" + rel, function(res) {
                if (res.statusCode !== status) {
                    callback(new Error("Bad status code: " + res.statusCode));
                } else {
                    callback(null);
                }
            });
        },
        "it fails with the correct error code": function(err) {
            assert.ifError(err);
        }
    };
};

var dialbackPost = function(endpoint, id, token, ts, requestBody, contentType, callback) {

    var reqOpts = urlparse(endpoint), auth;

    reqOpts.method = "POST";
    reqOpts.headers = {
        "Content-Type": contentType,
        "Content-Length": requestBody.length,
        "User-Agent": "activitypump-test/0.1.0dev"
    };

    if (id.indexOf("@") === -1) {
        auth = "Dialback host=\"" + id + "\", token=\""+token+"\"";
    } else {
        auth = "Dialback webfinger=\"" + id + "\", token=\""+token+"\"";
    }

    reqOpts.headers["Authorization"] = auth;
    reqOpts.headers["Date"] = (new Date(ts)).toUTCString();

    var req = http.request(reqOpts, function(res) {
        var body = "";
        res.setEncoding("utf8");
        res.on("data", function(chunk) {
            body = body + chunk;
        });
        res.on("error", function(err) {
            callback(err, null, null);
        });
        res.on("end", function() {
            callback(null, res, body);
        });
    });

    req.on("error", function(err) {
        callback(err, null, null);
    });

    req.write(requestBody);

    req.end();
};

exports.options = options;
exports.post = post;
exports.postJSON = postJSON;
exports.getJSON = getJSON;
exports.putJSON = putJSON;
exports.delJSON = delJSON;
exports.endpoint = endpoint;
exports.getfail = getfail;
exports.dialbackPost = dialbackPost;
