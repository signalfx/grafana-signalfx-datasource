// Copyright (C) 2019-2020 Splunk, Inc. All rights reserved.
export class SignalFxConfigCtrl {
    constructor($scope) {
        this.current.access = this.current.access || 'direct';
        this.accessTypes = [
            { name: 'Browser', value: 'direct' },
            { name: 'Server', value: 'proxy' },
        ];
    }
    onTokenReset($event) {
        $event.preventDefault();
        this.current.secureJsonFields.accessToken = false;
        this.current.secureJsonData = this.current.secureJsonData || {};
    }
    onAccessChange() {
        if (this.current.access === 'proxy') {
            this.current.jsonData.accessToken = null;
        }
    }
}
SignalFxConfigCtrl.templateUrl = 'partials/config.html';
