'use strict';

System.register(['lodash', './signalfx', './stream_handler', './proxy_handler'], function (_export, _context) {
    "use strict";

    var _, signalfx, StreamHandler, ProxyHandler, _createClass, SignalFxDatasource;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    return {
        setters: [function (_lodash) {
            _ = _lodash.default;
        }, function (_signalfx) {
            signalfx = _signalfx.default;
        }, function (_stream_handler) {
            StreamHandler = _stream_handler.StreamHandler;
        }, function (_proxy_handler) {
            ProxyHandler = _proxy_handler.ProxyHandler;
        }],
        execute: function () {
            _createClass = function () {
                function defineProperties(target, props) {
                    for (var i = 0; i < props.length; i++) {
                        var descriptor = props[i];
                        descriptor.enumerable = descriptor.enumerable || false;
                        descriptor.configurable = true;
                        if ("value" in descriptor) descriptor.writable = true;
                        Object.defineProperty(target, descriptor.key, descriptor);
                    }
                }

                return function (Constructor, protoProps, staticProps) {
                    if (protoProps) defineProperties(Constructor.prototype, protoProps);
                    if (staticProps) defineProperties(Constructor, staticProps);
                    return Constructor;
                };
            }();

            _export('SignalFxDatasource', SignalFxDatasource = function () {
                function SignalFxDatasource(instanceSettings, $q, backendSrv, templateSrv) {
                    _classCallCheck(this, SignalFxDatasource);

                    this.datasourceId = instanceSettings.id;
                    this.type = instanceSettings.type;
                    this.url = instanceSettings.url;
                    this.name = instanceSettings.name;
                    this.q = $q;
                    this.backendSrv = backendSrv;
                    this.templateSrv = templateSrv;
                    this.withCredentials = instanceSettings.withCredentials;
                    this.authToken = instanceSettings.jsonData.accessToken;
                    this.headers = { 'Content-Type': 'application/json' };
                    if (this.url.startsWith("/")) {
                        this.proxyAccess = true;
                    } else {
                        this.headers['X-SF-TOKEN'] = this.authToken;
                        this.endpoint = instanceSettings.url.replace(/^(http)(s)?:/, function (match, p1, p2) {
                            return 'ws' + (p2 || '') + ':';
                        });
                        console.log('Using SignalFx at ' + this.endpoint);
                        this.signalflow = window.signalfx.streamer.SignalFlow(this.authToken, {
                            signalflowEndpoint: this.endpoint
                        });
                    }
                    this.streams = [];
                    // give interpolateQueryStr access to this
                    this.interpolateQueryStr = this.interpolateQueryStr.bind(this);
                }

                _createClass(SignalFxDatasource, [{
                    key: 'query',
                    value: function query(options) {
                        var _this = this;

                        var queries = _.filter(options.targets, function (t) {
                            return t.hide !== true;
                        }).map(function (t) {
                            return _this.templateSrv.replace(t.program, options.scopedVars, _this.interpolateQueryStr);
                        });
                        var program = queries.join('\n');

                        var aliases = this.collectAliases(options);
                        var maxDelay = this.getMaxDelay(options);

                        // TODO: Better validation can be implemented here 
                        if (!program) {
                            return Promise.resolve({ data: [] });
                        }
                        return this.getSignalflowHandler(options).start(program, aliases, maxDelay, options);
                    }
                }, {
                    key: 'collectAliases',
                    value: function collectAliases(options) {
                        var _this2 = this;

                        return _.fromPairs(_.filter(options.targets, function (t) {
                            return t.hide !== true && t.program && t.alias;
                        }).map(function (t) {
                            return { program: _this2.templateSrv.replace(t.program, options.scopedVars || {}, _this2.interpolateQueryStr), alias: t.alias };
                        }).flatMap(function (t) {
                            return _this2.extractLabelsWithAlias(t.program, t.alias);
                        }));
                    }
                }, {
                    key: 'extractLabelsWithAlias',
                    value: function extractLabelsWithAlias(program, alias) {
                        var re = /label\s?=\s?'([\w]*?)'/igm;
                        var labels = [];
                        var m = void 0;
                        do {
                            m = re.exec(program);
                            if (m) {
                                labels.push([m[1], alias]);
                            }
                        } while (m);
                        return labels;
                    }
                }, {
                    key: 'getMaxDelay',
                    value: function getMaxDelay(options) {
                        var maxDelay = _.max(_.map(options.targets, function (t) {
                            return t.maxDelay;
                        }));
                        if (!maxDelay) maxDelay = 0;
                        return maxDelay;
                    }
                }, {
                    key: 'getSignalflowHandler',
                    value: function getSignalflowHandler(options) {
                        if (this.proxyAccess) {
                            return new ProxyHandler(this.datasourceId, this.backendSrv, this.templateSrv);
                        }
                        var handler = this.streams[options.panelId];
                        if (!handler) {
                            handler = new StreamHandler(this.signalflow, this.templateSrv);
                            this.streams[options.panelId] = handler;
                        }
                        return handler;
                    }
                }, {
                    key: 'testDatasource',
                    value: function testDatasource() {
                        return this.doRequest({
                            url: '/v2/metric',
                            method: 'GET'
                        }).then(function (response) {
                            if (response.status === 200) {
                                return { status: "success", message: "Data source is working", title: "Success" };
                            }
                        });
                    }
                }, {
                    key: 'metricFindQuery',
                    value: function metricFindQuery(query) {
                        var metricNameQuery = query.match(/^metrics\(([^\)]*?)\)/);
                        if (metricNameQuery) {
                            return this.getMetrics(this.templateSrv.replace(metricNameQuery[1]));
                        }
                        var propertyKeysQuery = query.match(/^property_keys\(([^\)]+?)(,\s?([^,]+?))?\)/);
                        if (propertyKeysQuery) {
                            return this.getPropertyKeys(this.templateSrv.replace(propertyKeysQuery[1]), this.templateSrv.replace(propertyKeysQuery[3]));
                        }
                        var propertyValuesQuery = query.match(/^property_values\(([^,]+?),\s?([^,]+?)(,\s?(.+))?\)/);
                        if (propertyValuesQuery) {
                            return this.getPropertyValues(this.templateSrv.replace(propertyValuesQuery[1]), this.templateSrv.replace(propertyValuesQuery[2]), this.templateSrv.replace(propertyValuesQuery[4]));
                        }
                        var tagsQuery = query.match(/^tags\(([^\)]+?)(,\s?([^,]+?))?\)/);
                        if (tagsQuery) {
                            return this.getTags(this.templateSrv.replace(tagsQuery[1]), this.templateSrv.replace(tagsQuery[3]));
                        }
                        // const globalTagsQuery = query.match(/^tags\(([^\)]*?)\)/);
                        // if (globalTagsQuery) {
                        //   return this.getGlobalTags(this.templateSrv.replace(globalTagsQuery[1]));
                        // }
                        this.q.when([]);
                    }
                }, {
                    key: 'getMetrics',
                    value: function getMetrics(query) {
                        var mapFunc = this.proxyAccess ? this.mapPropertiesToTextValue : this.mapMetricsToTextValue;
                        return this.doQueryRequest('/v2/metric', 'name:' + (query ? query : '*')).then(mapFunc);
                    }
                }, {
                    key: 'mapMetricsToTextValue',
                    value: function mapMetricsToTextValue(result) {
                        return _.map(result.data.results, function (d) {
                            return { text: d.name, value: d.name };
                        });
                    }
                }, {
                    key: 'getPropertyKeys',
                    value: function getPropertyKeys(metric, partialInput) {
                        return this.doSuggestQueryRequest(metric, null, partialInput);
                    }
                }, {
                    key: 'getPropertyValues',
                    value: function getPropertyValues(metric, propertyKey, partialInput) {
                        return this.doSuggestQueryRequest(metric, propertyKey, partialInput);
                    }
                }, {
                    key: 'getTags',
                    value: function getTags(metric, partialInput) {
                        return this.doSuggestQueryRequest(metric, 'sf_tags', partialInput);
                    }
                }, {
                    key: 'mapPropertiesToTextValue',
                    value: function mapPropertiesToTextValue(result) {
                        return _.map(result.data, function (d) {
                            return { text: d, value: d };
                        });
                    }
                }, {
                    key: 'doQueryRequest',
                    value: function doQueryRequest(path, query) {
                        return this.doRequest({
                            url: path,
                            params: { query: this.escapeQuery(query), limit: 100 },
                            method: 'GET'
                        });
                    }
                }, {
                    key: 'doSuggestQueryRequest',
                    value: function doSuggestQueryRequest(metric, property, partialInput) {
                        var program = {
                            programText: 'data(\'' + metric + '\').publish(label=\'A\')',
                            packageSpecifications: ''
                        };
                        var request = {
                            programs: [program],
                            property: property,
                            partialInput: partialInput != null ? partialInput : '',
                            limit: 100,
                            additionalFilters: [],
                            additionalReplaceOnlyFilters: [],
                            additionalQuery: null
                        };
                        return this.doRequest({
                            url: '/v2/suggest/_signalflowsuggest',
                            data: JSON.stringify(request),
                            method: 'POST'
                        }).then(this.mapPropertiesToTextValue);
                    }
                }, {
                    key: 'escapeQuery',
                    value: function escapeQuery(query) {
                        return query.replace(/[\/]/g, '\\$&');
                    }
                }, {
                    key: 'doRequest',
                    value: function doRequest(options) {
                        if (this.proxyAccess) {
                            return this.doBackendProxyRequest(options);
                        }
                        options.headers = this.headers;
                        options.url = this.url + options.url;
                        return this.backendSrv.datasourceRequest(options);
                    }
                }, {
                    key: 'doBackendProxyRequest',
                    value: function doBackendProxyRequest(options) {
                        options.data = {
                            queries: [{
                                datasourceId: this.datasourceId,
                                path: options.url,
                                query: _.toPairs(options.params).map(function (p) {
                                    return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]);
                                }).join('&'),
                                data: options.data
                            }]
                        };
                        options.url = '/api/tsdb/query';
                        options.method = 'POST';
                        return this.backendSrv.datasourceRequest(options).then(this.mapBackendProxyResponse);
                    }
                }, {
                    key: 'mapBackendProxyResponse',
                    value: function mapBackendProxyResponse(response) {
                        var table = response.data.results.items.tables[0];
                        var results = [];
                        for (var row = 0; row < table.rows.length; row++) {
                            results.push(table.rows[row][0]);
                        }
                        response.data = results;
                        return response;
                    }
                }, {
                    key: 'interpolateQueryStr',
                    value: function interpolateQueryStr(value, variable, defaultFormatFn) {
                        // if no multi or include all do not regexEscape
                        if (!variable.multi && !variable.includeAll) {
                            return this.escapeLiteral(value);
                        }

                        if (typeof value === 'string') {
                            return this.quoteLiteral(value);
                        }

                        var escapedValues = _.map(value, this.quoteLiteral);
                        return escapedValues.join(',');
                    }
                }, {
                    key: 'quoteLiteral',
                    value: function quoteLiteral(value) {
                        return "'" + String(value).replace(/'/g, "''") + "'";
                    }
                }, {
                    key: 'escapeLiteral',
                    value: function escapeLiteral(value) {
                        return String(value).replace(/'/g, "''");
                    }
                }]);

                return SignalFxDatasource;
            }());

            _export('SignalFxDatasource', SignalFxDatasource);
        }
    };
});
//# sourceMappingURL=datasource.js.map
