# leaflet-cache
````
L.TileLayer.addInitHook(function () {
    if (!this.options.useCache) {
        this._db = null;
        return;
    }
    this._db = idb;
});
L.Icon.addInitHook(function () {
    if (!this.options.useCache) {
        this._db = null;
        return;
    }
    this._db = idb;
});
```
