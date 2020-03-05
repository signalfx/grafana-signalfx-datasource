'use strict';

System.register(['lodash', './tag_processor'], function (_export, _context) {
    "use strict";

    var _, TagProcessor, _createClass, ProxyHandler;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    return {
        setters: [function (_lodash) {
            _ = _lodash.default;
        }, function (_tag_processor) {
            TagProcessor = _tag_processor.TagProcessor;
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

            _export('ProxyHandler', ProxyHandler = function () {
                function ProxyHandler(datasourceId, backendSrv, templateSrv) {
                    _classCallCheck(this, ProxyHandler);

                    this.datasourceId = datasourceId;
                    this.backendSrv = backendSrv;
                    this.templateSrv = templateSrv;
                    this.tagProcessor = new TagProcessor(templateSrv);
                }

                _createClass(ProxyHandler, [{
                    key: 'start',
                    value: function start(program, aliases, maxDelay, options) {
                        var _this = this;

                        this.aliases = aliases;
                        var refId = 'refId';
                        return this.backendSrv.datasourceRequest({
                            url: '/api/tsdb/query',
                            method: 'POST',
                            data: {
                                from: options.range.from.valueOf().toString(),
                                to: options.range.to.valueOf().toString(),
                                queries: [{
                                    refId: refId,
                                    intervalMs: options.intervalMs,
                                    maxDelay: maxDelay,
                                    maxDataPoints: options.maxDataPoints,
                                    datasourceId: this.datasourceId,
                                    program: program
                                }]
                            }
                        }).then(function (response) {
                            console.log(response);
                            if (response.status === 200) {
                                var seriesList = [];
                                var r = response.data.results[refId];
                                _.forEach(r.series, function (s) {
                                    var nameId = _this.tagProcessor.timeSeriesNameAndId(s.name, _this.unmarshallTags(s.tags), _this.aliases);
                                    seriesList.push({ target: nameId.name, datapoints: s.points, id: nameId.id });
                                });
                                seriesList.sort(function (a, b) {
                                    return a.id.localeCompare(b.id);
                                });
                                var data = {
                                    data: seriesList
                                };
                                return data;
                            }
                            throw { message: 'Error ' + response.status };
                        });
                    }
                }, {
                    key: 'unmarshallTags',
                    value: function unmarshallTags(marshalledTags) {
                        var tags = {};
                        for (var k in marshalledTags) {
                            var value = marshalledTags[k];
                            if (value) {
                                tags[k] = JSON.parse(value);
                            }
                        }
                        return tags;
                    }
                }]);

                return ProxyHandler;
            }());

            _export('ProxyHandler', ProxyHandler);
        }
    };
});
//# sourceMappingURL=proxy_handler.js.map
