import * as TimeQueue from "timequeue";
import * as EventEmitter from "events";
import { uid } from "uid";
import * as fs from "fs";
import * as ms from "ms";
import * as _F from 'lodash.filter'
const DefaultStoreOptions = {
    name: "store",
    path: process.cwd() + "/XennonStore",
    backups: {
        enabled: true,
        interval: "30 minutes",
    },
};
const DefaultFilterOptions = {
    strict: false,
};



export default class XennonStore extends EventEmitter.EventEmitter {
    private backups;
    private op;
    options;
    worker: (action: any, callback?: any) => void;
    queue: TimeQueue;
    backupInterval: any;

    constructor(options: {
        name?: string;
        path?: string;
        backups?: {
            enabled?: boolean;
            interval?: string;
        };
    } = DefaultStoreOptions) {
        super();
        this.options = options;
        this.backupInterval = null;
        if (!this.options.name) this.options.name = DefaultStoreOptions.name;
        if (!this.options.path) this.options.path = DefaultStoreOptions.path;
        if (!this.options.backups.enabled) {
            this.options.backups.enabled = DefaultStoreOptions.backups.enabled;
        }
        if (!this.options.backups.interval) {
            this.options.backups.interval = DefaultStoreOptions.backups.interval;
        }

        this._ensureCreated("folder", this.options.path);
        this._ensureCreated(
            "file",
            `${this.options.path}/${this.options.name}.json`,
        );

        this.worker = (action, callback = null) => {
            const data = action();
            if (callback) callback(data || null);
        };
        this.queue = new TimeQueue(this.worker, {
            concurrency: 1,
            every: 0,
        });
        if (this.options.backups.enabled) this.startBackups();
    }
    /**
       * Adds a new object to the store
       * @param {Object | Array<Object>} vals An object or an array of objects to add to the store
       * @returns {String | Array<String>} The ID of the item added, or an array of IDs belonging to the items added
       * @fires Store#added
       * 
       * @example <caption>Add a single item</caption>
       * Store.add({ my: 'item' })
       * @example <caption>Add multiple items</caption>
       * Store.add([
       *  { item: '1' },
       *  { item: '2' }
       * ])
       */
    add(vals) {
        return new Promise(async (resolve, reject) => {
            const newData = await this.object();

            if (Array.isArray(vals)) {
                let ids = [];
                let data = [];

                vals.forEach(async (val, index) => {
                    if (!val || val.constructor !== Object) {
                        return reject(new TypeError(`Value [${index}]: must be an object`));
                    }

                    if (Object.keys(val).length == 0) {
                        return reject(
                            new TypeError(`Value [${index}]: must not be an empty object`),
                        );
                    }
                    let id
                    // @ts-ignore
                    if (!val._id) {
                        id = uid(16);
                    } else {
                        id = val._id
                    }
                    newData[id] = val;

                    val._id = id

                    ids.push(id);
                    data.push(val);
                });

                this.queue.push(() => {
                    fs.writeFileSync(
                        `${this.options.path}/${this.options.name}.json`,
                        JSON.stringify(newData),
                    );
                }, () => {
                    /**
                               * Fires when a new item is added to the store
                               * 
                               * @event Store#added
                               * @property {Object | Array<Object>} value The item added, or an array of the items added
                               */
                    this.emit("added", data);

                    resolve(ids);
                });
            } else {
                const val = vals;

                if (!val || val.constructor !== Object) {
                    return reject(new TypeError("Value must be an object"));
                }

                if (Object.keys(val).length == 0) {
                    return reject(new TypeError("Value must not be an empty object"));
                }
                let id
                if (val._id) {
                    id = val._id
                } else {
                    id = uid(16);
                }
                newData[id] = val;

                val._id = id

                this.queue.push(() => {
                    fs.writeFileSync(
                        `${this.options.path}/${this.options.name}.json`,
                        JSON.stringify(newData),
                    );
                }, () => {
                    /**
                               * Fires when a new item is added to the store
                               * 
                               * @event Store#added
                               * @property {Object | Array<Object>} value The item added, or an array of the items added
                               */
                    this.emit("added", val);

                    resolve(id);
                });
            }
        });
    }

    /**
       * Get an item from the store
       * @param {String} id The ID of the item to get from the store
       * @returns {Object | undefined} The item that belongs to that ID, or undefined if none is found
       * 
       * @example <caption>Get an item using it's ID</caption>
       * Store.get('2xuxhuoyd5h5563v')
       */
    get(id) {
        return new Promise(async (resolve, reject) => {
            const data = await this.object();
            const item = data[id];

            if (!item) return resolve(undefined);
            else return resolve(item);
        });
    }

    /**
       * Indicates if a specific item how many items exist that match a provided filter
       * @param {Object | String} filter Either an object containing the keys/values to find by, a filter function that returns a truthy value, or the item's ID
       * @returns {Promise<Boolean | Array<[]>} Either a boolean indicating if an item is found, or an Array of the Items found
       * 
       * @example <caption>Check if an item exists using a filter object</caption>
       * Store.has({ myProp: 'myVal' })
       * 
       * @example <caption>Check if an item exists using an item's ID</caption>
       * Store.has('2xuxhuoyd5h5563v')
       */
    has(filter) {
        return new Promise(async (resolve, reject) => {
            switch (typeof filter) {
                case "string":
                    let item = await this.get(filter)
                    if (item) {
                        resolve(item)
                    } else reject(false)
                    break;
                case "object":
                    let all = await this.all()
                    console.log("HAS FILTER; ALL", all)
                    let filtered = _F(all, filter)
                    console.log("HAS FILTER; FILTERED", filtered)
                    break;

                default:
                    break;
            }
        });
    }

    /**
       * Ensures an item in the store exists, adding it if it doesn't
       * @param {Object | Function | String} filter Either an object containing the keys/values to find by, a filter function that returns a truthy value, or the item's ID
       * @param {Object} item The item to add to the store, if it doesn't exist
       * @returns {Promise<Boolean | String>} Returns either `true` if something matching the Filter exists, returns a string with the ID if `item` didn't exist
       * @fires Store#added
       * 
       * @example <caption>Ensure an item exists using a filter object</caption>
       * Store.ensure({ myProp: 'myVal' }, { myProp: 'myVal' })
       * 
       * @example <caption>Ensure an item exists using an item's ID</caption>
       * Store.ensure('2xuxhuoyd5h5563v', { myProp: 'myVal'})
       * @example <caption>Ensure an item exists using a Function</caption>
       * Store.ensure((s) => s.myProp === 'myVal', { myProp: 'myVal'})
       */
    ensure(filter, item) {
        return new Promise(async (resolve, reject) => {
            let data;
            let exists;
            switch (typeof filter) {
                case "object":
                    console.log("Filter is a Object");
                    break;
                case "function":
                    data = await this.filter(filter);
                    console.log(filter.toString())
                    if (data.length === 0) {
                        let added = await this.add(item);
                        resolve(added);
                    } else {
                        resolve(true);
                    }
                    break;
                case "string":
                    data = await this.get(filter)
                    if (data) {
                        return resolve(true)
                    } else {
                        item._id = filter
                        let added = await this.add(item)
                        return resolve(added)
                    }
                    break;
                default:
                    break;
            }
            resolve(true);
        });
    }

    /**
       * Get all items from the store
       * @returns {Promise<Object[]>} An array of items in the store
       * 
       * @example <caption>Get all items from the store as an array of objects</caption>
       * Store.all()
       */
    all(): Promise<Object[]> {
        return new Promise(async (resolve, reject) => {
            this.queue.push(() => {
                const data = fs.readFileSync(
                    `${this.options.path}/${this.options.name}.json`,
                    "utf8",
                );
                return JSON.parse(data.toString());
            }, (data) => {
                resolve(Object.values(data));
            });
        });
    }

    /**
       * Get all items from the store, in raw object (key- > value) form
       * @returns {Object} An object of items in the store
       *
       * @example <caption>Get all items from the store as a ID mapped object</caption>
       * Store.object()
       */
    object() {
        return new Promise(async (resolve, reject) => {
            this.queue.push(() => {
                const data = fs.readFileSync(
                    `${this.options.path}/${this.options.name}.json`,
                    "utf8",
                );
                return JSON.parse(data.toString());
            }, (data) => {
                resolve(data);
            });
        });
    }

    /**
       * Get all items from the store that match an object (key -> value) filter
       * @param {Object} obj An object containing the keys/values to filter by
       * @param {FilterOptions} [opts] The options for the filter
       * @returns {Array<Object>} An array of items in the store that matched the filter
       * 
       * @example <caption>Get all items from the store that match a filter object</caption>
       * Store.only({ myProp: 'myVal' })
       */
    only(obj, opts = DefaultFilterOptions) {
        return new Promise(async (resolve, reject) => {
            if (!opts.strict) opts.strict = false;

            const data = await this.all();
            // @ts-ignore
            const items = data.filter((x) => {
                let val;

                for (const o in obj) {
                    if (!x[o]) return val = false;

                    if (typeof (x[o]) === "string" && opts.strict === false) {
                        if (x[o].toLowerCase() === obj[o].toLowerCase()) return val = true;
                        else return val = false;
                    } else {
                        if (x[o] === obj[o]) return val = true;
                        else return val = false;
                    }
                }

                return val;
            });

            if (!items.length) return resolve([]);
            else return resolve(items);
        });
    }

    /**
       * Get all items from the store that match a function filter
       * @param {Function} func A function that returns a truthy value for items that match the filter
       * @returns {Array<Object>} An array of items in the store that matched the filter
       * 
       * @example <caption>Get all items from the store that match a filter function</caption>
       * Store.filter((item) => item.myProp === 'myVal')
       */
    filter(func) {
        return new Promise(async (resolve, reject) => {
            const data = await this.all();
            //            console.log("ALL DATA", data);
            // @ts-ignore
            const items = data.filter(func);
            //            console.log("FILTERED DATA", items);
            if (!items.length) return resolve([]);
            else return resolve(items);
        });
    }

    /**
       * Filters all items from the store that match a function filter, but only returns the first match
       * @param {Function} func A function that returns a truthy value for the item that matches the filter
       * @returns {Object | undefined} The item itself, or undefined if the item doesn't exist
       * 
       * @example <caption>Get the first item from the store that matchs a filter function</caption>
       * Store.first((item) => item.myProp === 'myVal')
       */
    first(func) {
        return new Promise(async (resolve, reject) => {
            const data = await this.all();
            // @ts-ignore
            const item = data.find(func);

            if (!item) return resolve(undefined);
            else return resolve(item);
        });
    }

    /**
       * Edit an item in the store
       * @param { String} key The Items ID, get the ID using somethig like `XennonStore.filter()`
       * @param {Object} newValues An object of keys/values to add, edit or remove to/from the item
       * @returns {Boolean | undefined} A boolean indicating the result of the action, or undefined if the item doesn't exist
       * @fires Store#edited
       * 
       * 
       * @example <caption>Edit an item using an item's ID</caption>
       * Store.edit('2xuxhuoyd5h5563v', { myProp: 'myNewVal', myNewVal: 'anotherNewVal' })
       */
    edit(key, newValues) {
        return new Promise(async (resolve, reject) => {
            const id = await this._get(key);
            if (!id) return resolve(undefined);

            const data = await this.object();
            // @ts-ignore
            const item = data[id];

            if (!item) return resolve(undefined);
            else {
                let newItem = item;
                const oldItem = item;

                for (const v of Object.keys(newValues)) {
                    if (!newItem[v]) newItem[v] = newValues[v];
                    else if (newValues[v] === undefined) delete newItem[v];
                    else newItem[v] = newValues[v];
                }

                // @ts-ignore
                data[id] = newItem;

                this.queue.push(() => {
                    fs.writeFileSync(
                        `${this.options.path}/${this.options.name}.json`,
                        JSON.stringify(data),
                    );
                }, () => {
                    /**
                               * Fired when an item in the store is edited
                               * 
                               * @event Store#edited
                               * @type {Object}
                               * @property {Object} old The value of the item before the edit
                               * @property {Object} new The value of the item after the edit
                               */
                    this.emit("edited", {
                        old: oldItem,
                        new: newItem,
                    });

                    resolve(true);
                });
            }
        });
    }
    /**
       * A combination function that edits an existing item, or adds a new item if it doesn't exist in the store
       * @param {Function | Object | String} key Either an object containing the keys/values to find by, a filter function that returns a truthy value, or the item's ID
       * @param {Object} newValues An object of keys/values to add, edit or remove to/from the item. If the item doesn't exist and is added, only keys with a truthy value are added.
       * @returns {Boolean | undefined} A boolean indicating the result of the action
       * @fires Store#added
       * @fires Store#edited
       * 
       * @example <caption>Upsert an item using a filter object</caption>
       * Store.upsert({ myProp: 'myVal' }, { myProp: 'myVal', myNewVal: 'anotherNewVal' })
       * 
       * @example <caption>Edit an item using an item's ID</caption>
       * Store.upsert('2xuxhuoyd5h5563v', { myProp: 'myVal', myNewVal: 'anotherNewVal' })
       */
    upsert(key, newValues) {
        return new Promise(async (resolve, reject) => {
            // TODO: upsert
        });
    }

    /**
       * Replace an item in the store entirely
       * @param {Function | Object | String} key Either an object containing the keys/values to find by, a filter function that returns a truthy value, or the item's ID
       * @param {Object} value The new object to replace the existing item in the store with
       * @returns {Boolean | undefined} A boolean indicating the result of the action, or undefined if the item doesn't exist
       * @fires Store#replaced
       * 
       * @example <caption>Replace an item using a filter object</caption>
       * Store.replace({ myProp: 'myVal' }, { myNewestProp: 'myNewestVal' })
       * 
       * @example <caption>Edit an item using an item's ID</caption>
       * Store.replace('2xuxhuoyd5h5563v', { myNewestProp: 'myNewestVal' })
       */
    replace(key, value) {
        return new Promise(async (resolve, reject) => {
            const id = await this._get(key);
            if (!id) return resolve(undefined);

            const data = await this.object();
            // @ts-ignore
            const item = data[id];

            if (!item) return resolve(undefined);
            else {
                const oldItem = item;

                value._id = item._id;

                // @ts-ignore
                data[id] = value;

                this.queue.push(() => {
                    fs.writeFileSync(
                        `${this.options.path}/${this.options.name}.json`,
                        JSON.stringify(data),
                    );
                }, () => {
                    /**
                               * Fired when an item in the store is replaced with a new item
                               * 
                               * @event Store#replaced
                               * @type {Object}
                               * @property {Object} old The value of the item before the replace
                               * @property {Object} new The value of the item after the replace
                               */
                    this.emit("replaced", {
                        old: oldItem,
                        new: value,
                    });

                    resolve(true);
                });
            }
        });
    }

    /**
       * Iterates ofer all items in the store and deletes items that match a filter provided
       * @param {Function | Object} filter Either an object containing the keys/values to filter by, or a filter function that returns a truthy value
       * @returns {Number} A number indicating how many items were deleted from the store
       * 
       * @example <caption>Sweep the store using a filter object</caption>
       * Store.sweep({ myProp: 'myVal' })
       */
    sweep(filter) {
        return new Promise(async (resolve, reject) => {
            let items;

            // Object
            if (this._isObject(filter)) {
                items = await this.only(filter);
                if (!items || !items.length) return resolve(undefined);
            }

            // Function
            if (typeof (filter) === "function") {
                items = await this.filter(filter);
                if (!items || !items.length) return resolve(undefined);
            }

            const actions = items.map((x) => this.delete(x._id));

            try {
                const results = await Promise.all(actions);

                return resolve(results.filter((x) => x === true).length);
            } catch (err) {
                return reject(err);
            }
        });
    }

    /**
       * Delete an item from the store
       * @param {Function | Object | String} key Either an object containing the keys/values to find by, a filter function that returns a truthy value, or the item's ID
       * @returns {Boolean | undefined} A boolean indicating the result of the action, or undefined if the item doesn't exist
       * @fires Store#deleted
       * 
       * @example <caption>Delete an item using a filter object</caption>
       * Store.delete({ myProp: 'myVal' })
       * 
       * @example <caption>Delete an item using an item's ID</caption>
       * Store.delete('2xuxhuoyd5h5563v')
       */
    delete(key) {
        return new Promise(async (resolve, reject) => {
            const id = await this._get(key);
            if (!id) return resolve(undefined);

            const data = await this.object();
            // @ts-ignore
            const item = data[id];

            if (!item) return resolve(undefined);
            else {
                const oldItem = item;

                // @ts-ignore
                delete data[id];

                this.queue.push(() => {
                    fs.writeFileSync(
                        `${this.options.path}/${this.options.name}.json`,
                        JSON.stringify(data),
                    );
                }, () => {
                    /**
                               * Fires when an item from the store is deleted
                               * 
                               * @event Store#deleted
                               * @property {Object} oldItem The item deleted from the store
                               */
                    this.emit("deleted", oldItem);

                    resolve(true);
                });
            }
        });
    }

    /**
       * Deletes all items from the store
       * @returns {Boolean} A boolean indicating the result of the action
       * @fires Store#emptied
       * 
       * @example <caption>Empty the store</caption>
       * Store.empty()
       */
    empty() {
        return new Promise(async (resolve, reject) => {
            this.queue.push(() => {
                fs.writeFileSync(
                    `${this.options.path}/${this.options.name}.json`,
                    "{}",
                );
            }, () => {
                /**
                         * Fires when the store is emptied
                         * 
                         * @event Store#emptied
                         */
                this.emit("emptied");

                resolve(true);
            });
        });
    }

    /**
       * Ensure a directory or file has been created and exists
       * @private
       * @param {'file' | 'folder'} type The type to ensure exists
       * @param {String} dir The full path or full path and filename to ensure exists
       * @returns {Boolean} A boolean indicating the result of the action
       * 
       * @example <caption>Ensure the data directory exists</caption>
       * Store._ensureCreated('folder', this.options.path)
       */
    _ensureCreated(type, dir) {
        const exists = fs.existsSync(dir);

        if (exists) return true;
        else {
            if (type === "file") {
                fs.writeFileSync(
                    `${this.options.path}/${this.options.name}.json`,
                    "{}",
                );
                return true;
            }

            if (type === "folder") {
                fs.mkdirSync(this.options.path);
                return true;
            }
        }
    }

    /**
       * Helper to check if a variable is an object
       * @param {*} obj Any variable to check
       * @returns {Boolean} A boolean indicating whether the variable is an object or not
       * 
       * @example <caption>Check if a variable is an object</caption>
       * Store._isObject(['array'])
       */
    _isObject(obj) {
        return Object.prototype.toString.call(obj) === "[object Object]";
    }

    /**
       * Helper to simplify fetching an item's ID using multiple filter methods
       * @private
       * @param {Object | Function | String} filter Either an object containing the keys/values to find by, a filter function that returns a truthy value, or the item's ID
       * @returns {String | undefined} The ID of the item, or undefined if none can be found
       * 
       * @example <caption>Get an item ID using a filter object</caption>
       * Store._get({ myProp: 'myVal' })
       * 
       * @example <caption>Get an item ID using an item's ID</caption>
       * Store._get('2xuxhuoyd5h5563v')
       */
    _get(filter) {
        return new Promise(async (resolve, reject) => {
            // Object
            if (this._isObject(filter)) {
                const item = await this.only(filter);
                // @ts-ignore
                if (!item || !item.length) return resolve(undefined);

                return resolve(item[0]._id);
            }

            // Function
            if (typeof (filter) === "function") {
                // @ts-ignore
                const item = await this.find(filter);
                if (!item) return resolve(undefined);

                return resolve(item._id);
            }

            // ID
            const item = await this.get(filter);
            if (!item) return resolve(undefined);
            // @ts-ignore
            return resolve(item._id);
        });
    }

    /**
       * Start the scheduled backups, using the store's backupInterval option
       * @returns {Boolean} A boolean indicating the result of the action
       * @fires Store#backupsStarted
       * 
       * @example <caption>Start scheduled backups</caption>
       * Store.startBackups()
       */
    startBackups() {
        return new Promise(async (resolve, reject) => {
            if (this.backupInterval !== null) {
                return reject(`Backups already running`);
            }

            this.backupInterval = setInterval(() => {
                this.backup();
            }, ms(this.options.backups.interval));

            /**
                   * Fires when scheduled backups are started
                   * 
                   * @event Store#backupsStarted
                   */
            this.emit("backupsStarted");

            return resolve(true);
        });
    }

    /**
       * Stop the scheduled backups
       * @returns {Boolean} A boolean indicating the result of the action
       * @fires Store#backupsStopped
       * 
       * @example <caption>Stop scheduled backups</caption>
       * Store.stopBackups()
       */
    stopBackups() {
        return new Promise(async (resolve, reject) => {
            if (this.backupInterval === null) {
                return reject(`Backups are not running`);
            }

            clearInterval(this.backupInterval);
            this.backupInterval = null;

            /**
                   * Fires when scheduled backups are stopped
                   * 
                   * @event Store#backupsStopped
                   */
            this.emit("backupsStopped");

            return resolve(true);
        });
    }

    /**
       * Create a backup of the store
       * @param {Boolean} [scheduled=false] A boolean indicating whether the backup is made by the scheduled backup interval or manually
       * @returns {Boolean} A boolean indicating the result of the action
       * @fires Store#backup 
       * 
       * @example <caption>Make a backup of the store</caption>
       * Store.backup()
       */
    backup(scheduled = false) {
        return new Promise((resolve, reject) => {
            this.queue.push(() => {
                fs.copyFileSync(
                    `${this.options.path}/${this.options.name}.json`,
                    `${this.options.path}/${this.options.name}--backup.json`,
                );
            }, () => {
                /**
                         * Fires when a new backup has been made
                         * 
                         * @event Store#backup
                         * @type {Object}
                         * @property {String} path The full path and filename, indicating where the backup is located
                         * @property {Boolean} scheduled A boolean indicating whether the backup is scheduled or not
                         */
                this.emit("backup", {
                    path: `${this.options.path}/${this.options.name}--backup.json`,
                    scheduled,
                });

                resolve(true);
            });
        });
    }

    /**
       * Replace the store's contents with the contents of an earlier or previous backup
       * @returns {Boolean} A boolean indicating the result of the action
       * @fires Store#restore
       * 
       * @example <caption>Restore the store from backup</caption>
       * Store.restore()
       */
    restore() {
        return new Promise((resolve, reject) => {
            const backupExists = fs.existsSync(
                `${this.options.path}/${this.options.name}--backup.json`,
            );

            if (!backupExists) {
                return reject(new Error(`Backup doesn't exist`));
            }

            this._ensureCreated("folder", this.options.path);
            this._ensureCreated(
                "file",
                `${this.options.path}/${this.options.name}.json`,
            );

            this.queue.push(() => {
                const data = fs.readFileSync(
                    `${this.options.path}/${this.options.name}--backup.json`,
                    "utf8",
                );
                return JSON.parse(data.toString());
            }, (data) => {
                this.queue.push(() => {
                    fs.writeFileSync(
                        `${this.options.path}/${this.options.name}.json`,
                        JSON.stringify(data),
                    );
                }, () => {
                    /**
                               * Fires when the store has been restored from a backup
                               * 
                               * @event Store#restore
                               */
                    this.emit("restore");

                    resolve(true);
                });
            });
        });
    }
    /**
       * Listen to Xennon Events
       * @param {"added"|"edited"|"replaced"|"deleted"|"emptied"|"backupsStarted"|"backupsStopped"|"backup"|"restore"|} value
       */
    // @ts-ignore
    on(value, func) {
        super.on(value, func);
    }
}