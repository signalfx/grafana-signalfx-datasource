'use strict';

System.register(['lodash', 'app/plugins/sdk'], function (_export, _context) {
    "use strict";

    var _, QueryCtrl, _createClass, SignalFxQueryCtrl;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    function _possibleConstructorReturn(self, call) {
        if (!self) {
            throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        }

        return call && (typeof call === "object" || typeof call === "function") ? call : self;
    }

    function _inherits(subClass, superClass) {
        if (typeof superClass !== "function" && superClass !== null) {
            throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
        }

        subClass.prototype = Object.create(superClass && superClass.prototype, {
            constructor: {
                value: subClass,
                enumerable: false,
                writable: true,
                configurable: true
            }
        });
        if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
    }

    return {
        setters: [function (_lodash) {
            _ = _lodash.default;
        }, function (_appPluginsSdk) {
            QueryCtrl = _appPluginsSdk.QueryCtrl;
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

            _export('SignalFxQueryCtrl', SignalFxQueryCtrl = function (_QueryCtrl) {
                _inherits(SignalFxQueryCtrl, _QueryCtrl);

                function SignalFxQueryCtrl($scope, $injector) {
                    _classCallCheck(this, SignalFxQueryCtrl);

                    var _this = _possibleConstructorReturn(this, (SignalFxQueryCtrl.__proto__ || Object.getPrototypeOf(SignalFxQueryCtrl)).call(this, $scope, $injector));

                    _this.lastError = null;
                    _this.panelCtrl.events.on('data-received', _this.onDataReceived.bind(_this), $scope);
                    _this.panelCtrl.events.on('data-error', _this.onDataError.bind(_this), $scope);
                    return _this;
                }

                _createClass(SignalFxQueryCtrl, [{
                    key: 'onDataReceived',
                    value: function onDataReceived(dataList) {
                        this.lastError = null;
                    }
                }, {
                    key: 'onDataError',
                    value: function onDataError(err) {
                        this.lastError = err.replace(/(?:\r\n|\r|\n)/g, '<br>');;
                    }
                }]);

                return SignalFxQueryCtrl;
            }(QueryCtrl));

            SignalFxQueryCtrl.templateUrl = 'partials/query.editor.html';

            _export('SignalFxQueryCtrl', SignalFxQueryCtrl);
        }
    };
});
//# sourceMappingURL=query_ctrl.js.map
