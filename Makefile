.PHONY: all
all: dist

.PHONY: dist
dist: dist-web dist-backend
	echo "Successfully built"

.PHONY: dist-web
dist-web:
	node_modules/.bin/grunt

.PHONY: dist-backend
dist-backend:
	GOOS=linux GOARCH=amd64 go build -o ./dist/signalfx-plugin_linux_amd64 ./pkg
	GOOS=darwin GOARCH=amd64 go build -o ./dist/signalfx-plugin_darwin_amd64 ./pkg
	GOOS=windows GOARCH=amd64 go build -o ./dist/signalfx-plugin_windows_amd64 ./pkg

.PHONY: plugin-linux
plugin-linux:
	GOOS=linux GOARCH=amd64 go build -o ./dist/signalfx-plugin_linux_amd64 ./pkg

.PHONY: clean
clean:
	node_modules/.bin/grunt clean
