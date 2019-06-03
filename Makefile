all: grunt deps build

.PHONY: ALL

deps:
	dep ensure

grunt:
	node_modules/.bin/grunt

build:
	GOOS=linux GOARCH=amd64 go build -o ./dist/signalfx-plugin_linux_amd64 ./pkg
	GOOS=darwin GOARCH=amd64 go build -o ./dist/signalfx-plugin_darwin_amd64 ./pkg
	GOOS=windows GOARCH=amd64 go build -o ./dist/signalfx-plugin_windows_amd64 ./pkg
