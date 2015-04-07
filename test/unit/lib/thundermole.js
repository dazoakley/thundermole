/* jshint maxstatements: false, maxlen: false */
/* global beforeEach, describe, it */
'use strict';

var assert = require('proclaim');
var mockery = require('mockery');

describe('lib/thundermole', function () {
	var api, http, httpProxy, StatsD, thundermole, underscore;

	beforeEach(function () {

		api = require('../mock/api');
		mockery.registerMock('./api', api);

		http = require('../mock/http');
		mockery.registerMock('http', http);

		httpProxy = require('../mock/http-proxy');
		mockery.registerMock('http-proxy', httpProxy);

		StatsD = require('../mock/node-statsd');
		mockery.registerMock('node-statsd', StatsD);

		underscore = require('../mock/underscore');
		mockery.registerMock('underscore', underscore);

		thundermole = require('../../../lib/thundermole');

	});

	it('should be a function', function () {
		assert.isFunction(thundermole);
	});

	it('should have a `defaults` property', function () {
		assert.isObject(thundermole.defaults);
	});

	describe('.defaults', function () {
		var defaults;

		beforeEach(function () {
			defaults = thundermole.defaults;
		});

		it('should have a `routes` property', function () {
			assert.isObject(defaults.routes);
			assert.deepEqual(defaults.routes, {});
		});

	});

	describe('thundermole()', function () {
		var instance, options;

		beforeEach(function () {
			options = {
				routes: {
					foo: 'http://foo.api/',
					default: 'http://default.api/'
				},
				statsd: {
					host: 'localhost'
				}
			};
			instance = thundermole(options);
		});

		it('should default the options', function () {
			assert.isTrue(underscore.defaults.calledOnce);
			assert.deepEqual(underscore.defaults.firstCall.args[0], {});
			assert.strictEqual(underscore.defaults.firstCall.args[1], options);
			assert.strictEqual(underscore.defaults.firstCall.args[2], thundermole.defaults);
		});

		it('should throw if no default route is defined in the options', function () {
			assert.throws(function () {
				thundermole({
					routes: {}
				});
			}, 'No default route is defined');
		});

		it('should create a new StatsD client with the correct options', function () {
			assert.isTrue(StatsD.calledOnce);
			assert.isTrue(StatsD.calledWithNew());
			assert.isTrue(StatsD.calledWith(options.statsd));
		});

		it('should store the StatsD client in the `statsd` property', function () {
			assert.strictEqual(instance.statsd, StatsD.firstCall.returnValue);
		});

		it('should create mock StatsD client if the `statsd` option is not present', function () {
			StatsD.reset();
			delete options.statsd;
			instance = thundermole(options);
			assert.isTrue(StatsD.calledOnce);
			assert.isTrue(StatsD.calledWithNew());
			assert.deepEqual(StatsD.firstCall.args[0], {mock: true});
		});

		it('should create an HTTP proxy', function () {
			assert.isTrue(httpProxy.createProxyServer.calledOnce);
		});

		it('should store the HTTP proxy in the `proxy` property', function () {
			assert.strictEqual(instance.proxy, httpProxy.createProxyServer.firstCall.returnValue);
		});

		it('should add a handler for the HTTP proxy "proxyReq" event', function () {
			assert.isTrue(instance.proxy.on.withArgs('proxyReq').calledOnce);
			assert.isFunction(instance.proxy.on.withArgs('proxyReq').firstCall.args[1]);
		});

		describe('"proxyReq" handler', function () {
			var proxyOptions, proxyReqHandler, proxyRequest, request, response;

			beforeEach(function () {
				proxyOptions = {
					append: {
						foo: 'bar'
					}
				};
				proxyReqHandler = instance.proxy.on.withArgs('proxyReq').firstCall.args[1];
				proxyRequest = new http.ClientRequest();
				request = new http.IncomingMessage();
				response = new http.ServerResponse();
				proxyReqHandler(proxyRequest, request, response, proxyOptions);
			});

			it('should remove the `X-Proxy-Appended-Data` header from the proxy request', function () {
				assert.isTrue(proxyRequest.removeHeader.withArgs('X-Proxy-Appended-Data').calledOnce);
			});

			it('should set the `X-Proxy-Appended-Data` to a JSON-serialised `proxyOptions.append`', function () {
				assert.isTrue(proxyRequest.setHeader.withArgs('X-Proxy-Appended-Data', '{"foo":"bar"}').calledOnce);
			});

			it('should set the `X-Proxy-Appended-Data` to a JSON-serialised empty object if `proxyOptions.append` is undefined', function () {
				delete proxyOptions.append;
				proxyReqHandler(proxyRequest, request, response, proxyOptions);
				assert.isTrue(proxyRequest.setHeader.withArgs('X-Proxy-Appended-Data', '{}').calledOnce);
			});

		});

		it('should add a handler for the HTTP proxy "error" event', function () {
			assert.isTrue(instance.proxy.on.withArgs('error').calledOnce);
			assert.isFunction(instance.proxy.on.withArgs('error').firstCall.args[1]);
		});

		describe('"error" handler', function () {
			var error, proxyErrorHandler, request, response;

			beforeEach(function () {
				error = new Error();
				proxyErrorHandler = instance.proxy.on.withArgs('error').firstCall.args[1];
				request = new http.IncomingMessage();
				response = new http.ServerResponse();
				proxyErrorHandler(error, request, response);
			});

			it('should respond with a `500` status code', function () {
				assert.isTrue(response.writeHead.withArgs(500).calledOnce);
			});

			it('should end the response', function () {
				assert.isTrue(response.end.calledOnce);
				assert.isString(response.end.firstCall.args[0]);
			});

		});

		it('should create an HTTP server', function () {
			assert.isTrue(http.createServer.calledOnce);
			assert.isFunction(http.createServer.firstCall.args[0]);
		});

		it('should store the HTTP server in the `server` property', function () {
			assert.strictEqual(instance.server, http.createServer.firstCall.returnValue);
		});

		describe('HTTP server "request" handler', function () {
			var request, response, serverRequestHandler;

			beforeEach(function () {
				request = new http.IncomingMessage();
				response = new http.ServerResponse();
				serverRequestHandler = http.createServer.firstCall.args[0];
				serverRequestHandler(request, response);
			});

			it('should call the API', function () {
				assert.isTrue(api.get.withArgs(request, options.routes).calledOnce);
				assert.isFunction(api.get.firstCall.args[2]);
			});

			describe('API "response" handler', function () {
				var apiResponse, apiResponseHandler;

				beforeEach(function () {
					apiResponse = {
						target: 'foo-target',
						append: {
							foo: 'foo-append',
							bar: 'bar-append'
						},
						nonStandardProperty: true
					};
					apiResponseHandler = api.get.firstCall.args[2];
				});

				describe('when API call is successful', function () {

					beforeEach(function () {
						apiResponseHandler(null, apiResponse);
					});

					it('should proxy the original request', function () {
						assert.isTrue(instance.proxy.web.withArgs(request, response).calledOnce);
					});

					it('should pass the proxy the API response `target` and `append` properties', function () {
						assert.deepEqual(instance.proxy.web.withArgs(request, response).firstCall.args[2], {
							target: apiResponse.target,
							append: apiResponse.append
						});
					});

					it('should pass the proxy any additional API response properties', function () {
						assert.isUndefined(instance.proxy.web.withArgs(request, response).firstCall.args[2].nonStandardProperty);
					});

				});

				describe('when API call is unsuccessful', function () {

					beforeEach(function () {
						apiResponseHandler(new Error(), apiResponse);
					});

					it('should respond with a `500` status code', function () {
						assert.isTrue(response.writeHead.withArgs(500).calledOnce);
					});

					it('should end the response', function () {
						assert.isTrue(response.end.calledOnce);
						assert.isString(response.end.firstCall.args[0]);
					});

					it('should not proxy the original request', function () {
						assert.isFalse(instance.proxy.web.called);
					});

				});

			});

		});

		it('should bind the HTTP server\'s `listen` method to the server', function () {
			assert.isTrue(instance.server.listen.bind.withArgs().calledOnce);
		});

		it('should return an object', function () {
			assert.isObject(instance);
		});

		describe('returned object', function () {

			it('should have a `proxy` property containing the HTTP proxy', function () {
				assert.strictEqual(instance.proxy, httpProxy.createProxyServer.firstCall.returnValue);
			});

			it('should have a `server` property containing the HTTP server', function () {
				assert.strictEqual(instance.server, http.createServer.firstCall.returnValue);
			});

			it('should have a `listen` method which aliases `server.listen`', function () {
				assert.strictEqual(instance.listen, instance.server.listen);
			});

		});

	});

});
