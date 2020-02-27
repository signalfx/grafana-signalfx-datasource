'use strict';

System.register(['lodash'], function (_export, _context) {
    "use strict";

    var _, _createClass, TagProcessor;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    return {
        setters: [function (_lodash) {
            _ = _lodash.default;
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

            _export('TagProcessor', TagProcessor = function () {
                function TagProcessor(templateSrv) {
                    _classCallCheck(this, TagProcessor);

                    this.templateSrv = templateSrv;
                }

                _createClass(TagProcessor, [{
                    key: 'timeSeriesNameAndId',
                    value: function timeSeriesNameAndId(tsId, tags, aliases) {
                        if (!tags) {
                            return { id: tsId, name: tsId };
                        }

                        var candidates = ['sf_metric', 'sf_originatingMetric'];
                        var excludedDimensions = ['sf_metric', 'sf_originatingMetric', 'jobId', 'programId', 'computationId'];

                        var tsVars = {};
                        var metricWithDims = [];
                        for (var c in candidates) {
                            var value = tags[candidates[c]];
                            if (value && !value.toLowerCase().startsWith('_sf_')) {
                                tsVars['metric'] = { text: value, value: value };
                                metricWithDims.push(value);
                            }
                        }

                        var key = [];
                        for (var k in tags['sf_key']) {
                            var dimension = tags['sf_key'][k];
                            if (excludedDimensions.indexOf(dimension) === -1) {
                                var _value = tags[dimension];
                                if (_value) {
                                    key.push(dimension + '=' + _value);
                                }
                            }
                        }

                        metricWithDims.push(key.join(','));

                        for (var _k in tags) {
                            if (excludedDimensions.indexOf(_k) === -1) {
                                var _value2 = tags[_k];
                                if (_value2) {
                                    tsVars[_k] = { text: _value2, value: _value2 };
                                }
                            }
                        }

                        var label = '';
                        var alias = null;
                        var streamLabel = tags['sf_streamLabel'];
                        if (streamLabel) {
                            tsVars['label'] = { text: streamLabel, value: streamLabel };
                            label = streamLabel + ':';
                            alias = aliases[streamLabel];
                        } else {
                            alias = _.find(aliases, function (a) {
                                return true;
                            });
                        }
                        var id = label + metricWithDims.join('/');
                        var name = alias ? this.templateSrv.replace(alias, tsVars) : id;
                        return { id: id, name: name };
                    }
                }]);

                return TagProcessor;
            }());

            _export('TagProcessor', TagProcessor);
        }
    };
});
//# sourceMappingURL=tag_processor.js.map
