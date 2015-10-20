L.Icon.prototype.options = L.Icon.prototype.options || {};
L.Icon.prototype.options.useCache = true;
L.Icon.prototype.options.saveToCache = true;
L.Icon.prototype.options.useOnlyCache = false;
L.Icon.prototype.options.cacheMaxAge = 24 * 3600 * 1000;


L.Icon.include({

    _createImg: function (src, el) {


        el = el || document.createElement('img');
        if (navigator.userAgent.indexOf('Chrome') !== -1) {
          el.src =  L.Util.emptyImageUrl;
        } else {
            el.src = 'img/empty.png';
        }







        this._loadTileBlob(src).then(function (data) {
            return this._onCacheLookup(src, data);
        }.bind(this)).then(function (blob) {
            el.onload = function (ev) {
                URL.revokeObjectURL(blob);
            };
            el.src = URL.createObjectURL(blob);
        }).catch(function (err) {
            console.log(err);

            //el.src = src;
        }.bind(this));
        return el;
    },



    _loadTileBlob: function (tileUrl) {
        if (this.options.useCache) {
            return this._db.get('cache', tileUrl);
        }
        return Promise.reject();
    },
    _getOnlineTile: function (tileUrl) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.responseType = "blob";
            xhr.addEventListener("error", reject);
            xhr.addEventListener("abort", reject);
            xhr.addEventListener("load", function () {
                if (xhr.status === 200) {
                    resolve(xhr.response);
                } else {
                    reject();
                }
            }, false);
            // Send XHR
            xhr.open("GET", tileUrl, true);
            xhr.send();
        });

    },
    // Returns a callback (closure over tile/key/originalSrc) to be run when the DB
    //   backend is finished with a fetch operation.
    _onCacheLookup: function (tileUrl, data) {
        return new Promise(function (resolve, reject) {
            if (data) {
                if (Date.now() > data.t + this.options.cacheMaxAge && !this.options.useOnlyCache) {
                    // Tile is too old, try to refresh it
                    // console.log('Tile is too old: ', tileUrl);
                    this._getOnlineTile(tileUrl).then(function (blob) {


                        if (this.options.saveToCache) {
                            if (navigator.userAgent.indexOf('Chrome') !== -1) {
                                this._saveBlob(tileUrl, blob);
                            } else {
                                this._saveBase64(tileUrl, blob);
                            }
                        }

                        resolve(blob);
                    }.bind(this)).catch(function () {
                        resolve(data.d);
                    });
                } else {
                    // Serve tile from cached data
                    // console.log('Tile is cached: ', tileUrl);

                    if (navigator.userAgent.indexOf('Chrome') !== -1) {
                        resolve(data.d);
                    } else {
                        blobUtil.base64StringToBlob(data.d).then(function (blob) {
                            resolve(blob);
                        }).catch(function (err) {
                            console.log(err);
                        });
                    }
                }
            } else {
                if (this.options.useOnlyCache) {
                    // Offline, not cached
                    // console.log('Tile not in cache', tileUrl);
                    reject();
                } else {
                    // Online, not cached, request the tile normally
                    // console.log('Requesting tile normally', tileUrl);

                    if (this.options.saveToCache) {
                        this._getOnlineTile(tileUrl).then(function (blob) {

                            if (navigator.userAgent.indexOf('Chrome') !== -1) {
                                this._saveBlob(tileUrl, blob);
                            } else {
                                this._saveBase64(tileUrl, blob);
                            }
                            resolve(blob);
                        }.bind(this)).catch(function () {
                            reject();
                        });
                    } else {
                        reject();
                    }
                }
            }
        }.bind(this));
    },
    _saveBlob: function (tileUrl, blob) {
        var doc = {
            i: tileUrl,
            d: blob,
            t: Date.now()
        };
        this._db.put('cache', doc);
    },
    _saveBase64: function (tileUrl, blob) {
        blobUtil.blobToBase64String(blob).then(function (base64String) {
            var doc = {
                i: tileUrl,
                d: base64String,
                t: Date.now()
            };

            this._db.put('cache', doc);
        }.bind(this)).catch(function (err) {
            console.log(err);
        });

    }

});
