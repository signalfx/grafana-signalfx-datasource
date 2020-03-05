'use strict';

System.register([], function (_export, _context) {
    "use strict";

    var _createClass, SignalFxConfigCtrl;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    return {
        setters: [],
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

            _export('SignalFxConfigCtrl', SignalFxConfigCtrl = function () {
                function SignalFxConfigCtrl($scope) {
                    _classCallCheck(this, SignalFxConfigCtrl);

                    this.current.access = this.current.access || 'direct';
                    this.accessTypes = [{ name: 'Browser', value: 'direct' }, { name: 'Server', value: 'proxy' }];
                }

                _createClass(SignalFxConfigCtrl, [{
                    key: 'onTokenReset',
                    value: function onTokenReset($event) {
                        $event.preventDefault();
                        this.current.secureJsonFields.accessToken = false;
                        this.current.secureJsonData = this.current.secureJsonData || {};
                    }
                }, {
                    key: 'onAccessChange',
                    value: function onAccessChange() {
                        if (this.current.access === 'proxy') {
                            this.current.jsonData.accessToken = null;
                        }
                        console.log(this.current.access);
                    }
                }]);

                return SignalFxConfigCtrl;
            }());

            _export('SignalFxConfigCtrl', SignalFxConfigCtrl);

            SignalFxConfigCtrl.templateUrl = 'partials/config.html';
        }
    };
});
//# sourceMappingURL=config_ctrl.js.map
