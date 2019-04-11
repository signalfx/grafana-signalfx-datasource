'use strict';

System.register([], function (_export, _context) {
    "use strict";

    var SignalFxConfigCtrl;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    return {
        setters: [],
        execute: function () {
            _export('SignalFxConfigCtrl', SignalFxConfigCtrl = function SignalFxConfigCtrl($scope) {
                _classCallCheck(this, SignalFxConfigCtrl);

                this.current.access = 'direct';
            });

            _export('SignalFxConfigCtrl', SignalFxConfigCtrl);

            SignalFxConfigCtrl.templateUrl = 'partials/config.html';
        }
    };
});
//# sourceMappingURL=config_ctrl.js.map
