import PreloadFile from '../generic/preload_file';
import { BaseFileSystem, FileSystem, BFSOneArgCallback, BFSCallback, FileSystemOptions } from '../core/file_system';
import { FileFlag } from '../core/file_flag';
import { default as Stats, FileType } from '../core/node_fs_stats';
import { ApiError, ErrorCode } from '../core/api_error';
import { File } from '../core/file';
import { each as asyncEach } from 'async';
import * as path from 'path';
import { arrayBuffer2Buffer, buffer2ArrayBuffer, emptyBuffer, deprecationMessage } from '../core/util';

/**
 * @hidden
 */
let errorCodeLookup: { [errCode: string]: ErrorCode };
/**
 * Lazily construct error code lookup, since DropboxJS might be loaded *after* BrowserFS (or not at all!)
 * @hidden
 */
function constructErrorCodeLookup() {
  if (errorCodeLookup) {
    return;
  }
  errorCodeLookup = {};
  errorCodeLookup[Errors.GENERAL_FAILURE] = ErrorCode.EIO;
  errorCodeLookup[Errors.CREATION_ERROR] = ErrorCode.EIO;
  errorCodeLookup[Errors.WRITE_ERROR] = ErrorCode.EIO;
  errorCodeLookup[Errors.IS_DIR] = ErrorCode.EISDIR;
  errorCodeLookup[Errors.IS_FILE] = ErrorCode.ENOTDIR;
  errorCodeLookup[Errors.NO_INPUT] = ErrorCode.EINVAL;
  errorCodeLookup[Errors.OPEN_ERROR] = ErrorCode.EIO;
  errorCodeLookup[Errors.OUT_OF_FS] = ErrorCode.EPERM;
}

/**
 * @hidden
 */
interface ICachedPathInfo {
  stat: Dropbox.File.Stat;
}

/**
 * @hidden
 */
interface ICachedFileInfo extends ICachedPathInfo {
  contents: ArrayBuffer;
}

// /**
//  * @hidden
//  */
// function isFileInfo(cache: ICachedPathInfo): cache is ICachedFileInfo {
//   return cache && cache.stat.isFile;
// }

/**
 * @hidden
 */
interface ICachedDirInfo extends ICachedPathInfo {
  contents: string[];
}

// /**
//  * @hidden
//  */
// function isDirInfo(cache: ICachedPathInfo): cache is ICachedDirInfo {
//   return cache && cache.stat.isFolder;
// }

const parseOptions = (input: string) => {
  const full: { [key: string]: any } = {};
  const inputSplit = input.split("\n");
  for (const element of inputSplit) {
    if (element.includes("=\"")) {
      const optVal = element.slice(element.indexOf("=") + 1).slice(1).slice(0, -1);
      const booleanValue = (optVal === "true" || optVal === "false") ? optVal === "true" : undefined;
      const optKey = element.split("=")[0];
      full[optKey] = (booleanValue === undefined ? optVal : booleanValue);
    }
  }
  return full;
};

export interface RealFsStat { itemType: string; ctime: string; mode: string; size: string; mtime: string; atime: string; };

/**
 * @hidden
 */
function isArrayBuffer(ab: any): ab is ArrayBuffer {
  // Accept null / undefined, too.
  return ab === null || ab === undefined || (typeof (ab) === 'object' && typeof (ab['byteLength']) === 'number');
}

const Errors = {
  GENERAL_FAILURE: "Meta call failed",
  IS_FILE: "Is a file",
  IS_DIR: "Is a dir",
  NO_INPUT: "No input",
  OUT_OF_FS: "Out of scope",
  WRITE_ERROR: "Write error",
  OPEN_ERROR: "Open error",
  CREATION_ERROR: "File didn't exist, creation caused errors",
  OK: "OK",
};

/**
 * Wraps a Dropbox client and caches operations.
 * @hidden
 */
class RealFSClient {
  private _cache: { [path: string]: ICachedPathInfo } = {};
  private _client: Dropbox.Client;

  private _apiUrl: string
  constructor(apiUrl: string) {
    // this._client = client;
    this._apiUrl = apiUrl;
  }

  private _makeRequest(kind: "read" | "write" | "list" | "stat", filePath: string, callback: (err: Error | null, response?: Response) => void, postData?: ArrayBuffer) {
    const constructedFullApiUrl = [
      this._apiUrl,
    ];
    let targetMethod = "";
    // const dataToPost = [];
    const search: { key: string, value: string }[] = [];
    const appendPath = (path: string) => search.push({ key: "path", value: encodeURIComponent(path) });
    switch (kind) {
      case "read":
        constructedFullApiUrl.push("file");
        targetMethod = "GET";
        appendPath(filePath);
        break;
      case "list":
        constructedFullApiUrl.push("directory")
        targetMethod = "GET";
        appendPath(filePath);
        break;
      case "stat":
        constructedFullApiUrl.push("stat")
        targetMethod = "GET";
        appendPath(filePath);
        break;
      case "write":
        constructedFullApiUrl.push("file");
        targetMethod = "POST";
        appendPath(filePath);
        break;
      default:
        break;
    }
    const req = fetch(constructedFullApiUrl.join("/") + (search.length > 0 ? `?${search.map((x) => `${x.key}=${x.value}`).join("&")}` : ""), {
      method: targetMethod,
      body: postData,
    });
    req.catch((x) => {
      callback(x);
    });
    req.then((x) => {
      callback(null, x);
    });
  }

  public readdir(p: string, cb: (error: Error | null, contents?: string[]) => void): void {
    /*
        const cacheInfo = this.getCachedDirInfo(p);

        this._wrap((interceptCb) => {
          if (cacheInfo !== null && cacheInfo.contents) {
            this._client.readdir(p, {
              contentHash: cacheInfo.stat.contentHash
            }, interceptCb);
          } else {
            this._client.readdir(p, interceptCb);
          }
        }, (err: Dropbox.ApiError, filenames: string[], stat: Dropbox.File.Stat, folderEntries: Dropbox.File.Stat[]) => {
          if (err) {
            if (err.status === Dropbox.ApiError.NO_CONTENT && cacheInfo !== null) {
              cb(null, cacheInfo.contents.slice(0));
            } else {
              cb(err);
            }
          } else {
            this.updateCachedDirInfo(p, stat, filenames.slice(0));
            folderEntries.forEach((entry) => {
              this.updateCachedInfo(path.join(p, entry.name), entry);
            });
            cb(null, filenames);
          }
        });
    */
    this._makeRequest("list", p, (err, contents) => {
      if (err) {
        cb(err);
      }
      else {
        if (contents == undefined) {
          return;
        }
        if (contents.status != 200) {
          const convertErrorMsg = (errorMsg: keyof typeof Errors) => new Error(errorMsg);
          switch (contents.statusText) {
            case Errors.IS_FILE:
              cb(convertErrorMsg("IS_FILE"));
              break;
            case Errors.OUT_OF_FS:
              cb(convertErrorMsg("OUT_OF_FS"));
              break;
            case Errors.GENERAL_FAILURE:
              cb(convertErrorMsg("GENERAL_FAILURE"));
              break;
            default:
              break;
          }
          return;
        }
        else {
          // cb(null, (await contents.text()).split("\n"));
          contents.text().then((x2) => {
            cb(null, x2.split("\n").filter((x) => x.length > 0));
          });
        }
      }
    });
  }

  public remove(p: string, cb: (error?: Error | null) => void): void {
    // this._wrap((interceptCb) => {
    //   this._client.remove(p, interceptCb);
    // }, (err: Dropbox.ApiError, stat?: Dropbox.File.Stat) => {
    //   if (!err) {
    //     this.updateCachedInfo(p, stat!);
    //   }
    //   cb(err);
    // });
    cb(new Error("Unimplemented"));
  }

  public move(src: string, dest: string, cb: (error?: Error) => void): void {
    // this._wrap((interceptCb) => {
    //   this._client.move(src, dest, interceptCb);
    // }, (err: Dropbox.ApiError, stat: Dropbox.File.Stat) => {
    //   if (!err) {
    //     this.deleteCachedInfo(src);
    //     this.updateCachedInfo(dest, stat);
    //   }
    //   cb(err);
    // });
    cb(new Error("Unimplemented"));
  }

  public stat(p: string, cb: (error: Error | null, stat?: RealFsStat) => void): void {
    // this._wrap((interceptCb) => {
    //   this._client.stat(p, interceptCb);
    // }, (err: Dropbox.ApiError, stat: Dropbox.File.Stat) => {
    //   if (!err) {
    //     this.updateCachedInfo(p, stat);
    //   }
    //   cb(err, stat);
    // });
    // cb(new Error("Unimplemented"));
    this._makeRequest("stat", p, (err, contents) => {
      if (err) {
        cb(err);
      }
      else {
        if (contents == undefined) {
          return;
        }
        if (contents.status != 200) {
          const convertErrorMsg = (errorMsg: keyof typeof Errors) => new Error(errorMsg);
          switch (contents.statusText) {
            case Errors.OUT_OF_FS:
              cb(convertErrorMsg("OUT_OF_FS"));
              break;
            case Errors.GENERAL_FAILURE:
              cb(convertErrorMsg("GENERAL_FAILURE"));
              break;
            default:
              break;
          }
          return;
        }
        else {
          contents.text().then((x2) => {
            cb(null, parseOptions(x2) as RealFsStat);
          });
        }
      }
    });
  }

  public readFile(p: string, cb: (error: Error | null, file?: ArrayBuffer, stat?: RealFsStat) => void): void {
    // const cacheInfo = this.getCachedFileInfo(p);
    // if (cacheInfo !== null && cacheInfo.contents !== null) {
    //   // Try to use cached info; issue a stat to see if contents are up-to-date.
    //   this.stat(p, (error, stat?) => {
    //     if (error) {
    //       cb(error);
    //     } else if (stat!.contentHash === cacheInfo!.stat.contentHash) {
    //       // No file changes.
    //       cb(error, cacheInfo!.contents.slice(0), cacheInfo!.stat);
    //     } else {
    //       // File changes; rerun to trigger actual readFile.
    //       this.readFile(p, cb);
    //     }
    //   });
    // } else {
    //   this._wrap((interceptCb) => {
    //     this._client.readFile(p, { arrayBuffer: true }, interceptCb);
    //   }, (err: Dropbox.ApiError, contents: any, stat: Dropbox.File.Stat) => {
    //     if (!err) {
    //       this.updateCachedInfo(p, stat, contents.slice(0));
    //     }
    //     cb(err, contents, stat);
    //   });
    // }
    // cb(new Error("Unimplemented"));
    this._makeRequest("read", p, (err, contents) => {
      if (err) {
        cb(err);
      }
      else {
        if (contents == undefined) {
          return;
        }
        if (contents.status != 200) {
          const convertErrorMsg = (errorMsg: keyof typeof Errors) => new Error(errorMsg);
          switch (contents.statusText) {
            case Errors.OUT_OF_FS:
              cb(convertErrorMsg("OUT_OF_FS"));
              break;
            case Errors.GENERAL_FAILURE:
              cb(convertErrorMsg("GENERAL_FAILURE"));
              break;
            default:
              break;
          }
          return;
        }
        else {
          contents.arrayBuffer().then((x2) => {
            // cb(null, x2, );
            this.stat(p, (err, stat) => {
              cb(err, x2, stat);
            });
          });
        }
      }
    });
  }

  public writeFile(p: string, contents: ArrayBuffer, cb: (error: Error | null, stat?: RealFsStat) => void): void {
    // this._wrap((interceptCb) => {
    //   this._client.writeFile(p, contents, interceptCb);
    // }, (err: Dropbox.ApiError, stat: Dropbox.File.Stat) => {
    //   if (!err) {
    //     this.updateCachedInfo(p, stat, contents.slice(0));
    //   }
    //   cb(err, stat);
    // });
    // cb(new Error("Unimplemented"));
    this._makeRequest("write", p, (err, contents) => {
      if (err) {
        cb(err);
      }
      else {
        if (contents == undefined) {
            return;
        }
        if (contents.status != 200) {
          const convertErrorMsg = (errorMsg: keyof typeof Errors) => new Error(errorMsg);
          switch (contents.statusText) {
            case Errors.OPEN_ERROR:
              cb(convertErrorMsg("OPEN_ERROR"));
              break;
            case Errors.WRITE_ERROR:
              cb(convertErrorMsg("WRITE_ERROR"));
              break;
            case Errors.CREATION_ERROR:
              cb(convertErrorMsg("CREATION_ERROR"));
              break;
            case Errors.OUT_OF_FS:
              cb(convertErrorMsg("OUT_OF_FS"));
              break;
            case Errors.GENERAL_FAILURE:
              cb(convertErrorMsg("GENERAL_FAILURE"));
              break;
            default:
              break;
          }
          return;
        }
        else {
          this.stat(p, (err, stat) => {
            cb(err, stat);
          });
        }
      }
    }, contents);
  }

  public mkdir(p: string, cb: (error?: Dropbox.ApiError) => void): void {
    this._wrap((interceptCb) => {
      this._client.mkdir(p, interceptCb);
    }, (err: Dropbox.ApiError, stat: Dropbox.File.Stat) => {
      if (!err) {
        this.updateCachedInfo(p, stat, []);
      }
      cb(err);
    });
  }

  /**
   * Wraps an operation such that we retry a failed operation 3 times.
   * Necessary to deal with Dropbox rate limiting.
   *
   * @param performOp Function that performs the operation. Will be called up to three times.
   * @param cb Called when the operation succeeds, fails in a non-temporary manner, or fails three times.
   */
  private _wrap(performOp: (interceptCb: (error: Dropbox.ApiError) => void) => void, cb: Function): void {
    let numRun = 0;
    const interceptCb = function (error: Dropbox.ApiError): void {
      // Timeout duration, in seconds.
      const timeoutDuration: number = 2;
      if (error && 3 > (++numRun)) {
        switch (error.status) {
          case Dropbox.ApiError.SERVER_ERROR:
          case Dropbox.ApiError.NETWORK_ERROR:
          case Dropbox.ApiError.RATE_LIMITED:
            setTimeout(() => {
              performOp(interceptCb);
            }, timeoutDuration * 1000);
            break;
          default:
            cb.apply(null, arguments);
            break;
        }
      } else {
        cb.apply(null, arguments);
      }
    };

    performOp(interceptCb);
  }

  private getCachedInfo(p: string): ICachedPathInfo {
    return this._cache[p.toLowerCase()];
  }

  private putCachedInfo(p: string, cache: ICachedPathInfo): void {
    this._cache[p.toLowerCase()] = cache;
  }

  // private deleteCachedInfo(p: string): void {
  //   delete this._cache[p.toLowerCase()];
  // }

  // private getCachedDirInfo(p: string): ICachedDirInfo | null {
  //   const info = this.getCachedInfo(p);
  //   if (isDirInfo(info)) {
  //     return info;
  //   } else {
  //     return null;
  //   }
  // }

  // private getCachedFileInfo(p: string): ICachedFileInfo | null {
  //   const info = this.getCachedInfo(p);
  //   if (isFileInfo(info)) {
  //     return info;
  //   } else {
  //     return null;
  //   }
  // }

  private updateCachedDirInfo(p: string, stat: Dropbox.File.Stat, contents: string[] | null = null): void {
    const cachedInfo = this.getCachedInfo(p);
    // Dropbox uses the *contentHash* property for directories.
    // Ignore stat objects w/o a contentHash defined; those actually exist!!!
    // (Example: readdir returns an array of stat objs; stat objs for dirs in that context have no contentHash)
    if (stat.contentHash !== null && (cachedInfo === undefined || cachedInfo.stat.contentHash !== stat.contentHash)) {
      this.putCachedInfo(p, <ICachedDirInfo>{
        stat: stat,
        contents: contents
      });
    }
  }
  // "dist": "npm-run-all build lint script:make_dist dist:build:node",
  private updateCachedFileInfo(p: string, stat: Dropbox.File.Stat, contents: ArrayBuffer | null = null): void {
    const cachedInfo = this.getCachedInfo(p);
    // Dropbox uses the *versionTag* property for files.
    // Ignore stat objects w/o a versionTag defined.
    if (stat.versionTag !== null && (cachedInfo === undefined || cachedInfo.stat.versionTag !== stat.versionTag)) {
      this.putCachedInfo(p, <ICachedFileInfo>{
        stat: stat,
        contents: contents
      });
    }
  }

  private updateCachedInfo(p: string, stat: Dropbox.File.Stat, contents: ArrayBuffer | string[] | null = null): void {
    if (stat.isFile && isArrayBuffer(contents)) {
      this.updateCachedFileInfo(p, stat, contents);
    } else if (stat.isFolder && Array.isArray(contents)) {
      this.updateCachedDirInfo(p, stat, contents);
    }
  }
}
// "build": "npm-run-all --parallel build:tsc build:scripts --sequential build:rollup --parallel build:webpack build:webpack-release",

export class RealFile extends PreloadFile<RealFileSystem> implements File {
  constructor(_fs: RealFileSystem, _path: string, _flag: FileFlag, _stat: Stats, contents?: Buffer) {
    super(_fs, _path, _flag, _stat, contents);
  }

  public sync(cb: BFSOneArgCallback): void {
    if (this.isDirty()) {
      const buffer = this.getBuffer(),
        arrayBuffer = buffer2ArrayBuffer(buffer);
      this._fs._writeFileStrict(this.getPath(), arrayBuffer, (e?: ApiError) => {
        if (!e) {
          this.resetDirty();
        }
        cb(e);
      });
    } else {
      cb();
    }
  }

  public close(cb: BFSOneArgCallback): void {
    this.sync(cb);
  }
}

/**
 * Options for the Dropbox file system.
 */
export interface DropboxFileSystemOptions {
  // An *authenticated* Dropbox client. Must be from the 0.10 JS SDK.
  // client: Dropbox.Client;

  apiUrl: string;
}

/**
 * A read/write file system backed by Dropbox cloud storage.
 *
 * Uses the Dropbox V1 API.
 *
 * NOTE: You must use the v0.10 version of the [Dropbox JavaScript SDK](https://www.npmjs.com/package/dropbox).
 */
export default class RealFileSystem extends BaseFileSystem implements FileSystem {
  public static readonly Name = "Dropbox";

  public static readonly Options: FileSystemOptions = {
    // client: {
    //   type: "object",
    //   description: "An *authenticated* Dropbox client. Must be from the 0.10 JS SDK.",
    //   validator: (opt: Dropbox.Client, cb: BFSOneArgCallback): void => {
    //     if (opt.isAuthenticated && opt.isAuthenticated()) {
    //       cb();
    //     } else {
    //       cb(new ApiError(ErrorCode.EINVAL, `'client' option must be an authenticated Dropbox client from the v0.10 JS SDK.`));
    //     }
    //   }
    // }
    apiUrl: {
      type: "string",
      description: "API endpoint that contains the RealFS server"
    }
  };

  /**
   * Creates a new DropboxFileSystem instance with the given options.
   * Must be given an *authenticated* DropboxJS client from the old v0.10 version of the Dropbox JS SDK.
   */
  public static Create(opts: DropboxFileSystemOptions, cb: BFSCallback<RealFileSystem>): void {
    cb(null, new RealFileSystem(opts.apiUrl, false));
  }

  public static isAvailable(): boolean {
    // Checks if the Dropbox library is loaded.
    return typeof Dropbox !== 'undefined';
  }

  // The Dropbox client.
  private _client: RealFSClient;

  /**
   * **Deprecated. Please use Dropbox.Create() method instead.**
   *
   * Constructs a Dropbox-backed file system using the *authenticated* DropboxJS client.
   *
   * Note that you must use the old v0.10 version of the Dropbox JavaScript SDK.
   */
  constructor(apiUrl: string, deprecateMsg = true) {
    super();
    this._client = new RealFSClient(apiUrl);
    deprecationMessage(deprecateMsg, RealFileSystem.Name, { client: "authenticated dropbox client instance" });
    constructErrorCodeLookup();
  }

  public getName(): string {
    return RealFileSystem.Name;
  }

  public isReadOnly(): boolean {
    return false;
  }

  // Dropbox doesn't support symlinks, properties, or synchronous calls

  public supportsSymlinks(): boolean {
    return false;
  }

  public supportsProps(): boolean {
    return false;
  }

  public supportsSynch(): boolean {
    return false;
  }

  public empty(mainCb: BFSOneArgCallback): void {
    this._client.readdir('/', (error, files) => {
      if (error) {
        mainCb(this.convert(error.message, '/'));
      } else {
        const deleteFile = (file: string, cb: BFSOneArgCallback) => {
          const p = path.join('/', file);
          this._client.remove(p, (err) => {
            cb(err ? this.convert(err.message, p) : null);
          });
        };
        const finished = (err?: ApiError) => {
          if (err) {
            mainCb(err);
          } else {
            mainCb();
          }
        };
        // XXX: <any> typing is to get around overly-restrictive ErrorCallback typing.
        asyncEach(files!, <any>deleteFile, <any>finished);
      }
    });
  }

  public rename(oldPath: string, newPath: string, cb: BFSOneArgCallback): void {
    // this._client.move(oldPath, newPath, (error) => {
    //   if (error) {
    //     // the move is permitted if newPath is a file.
    //     // Check if this is the case, and remove if so.
    //     this._client.stat(newPath, (error2, stat) => {
    //       if (error2 || stat!.isFolder) {
    //         const missingPath = (<any>error.response).error.indexOf(oldPath) > -1 ? oldPath : newPath;
    //         cb(this.convert(error, missingPath));
    //       } else {
    //         // Delete file, repeat rename.
    //         this._client.remove(newPath, (error2) => {
    //           if (error2) {
    //             cb(this.convert(error2, newPath));
    //           } else {
    //             this.rename(oldPath, newPath, cb);
    //           }
    //         });
    //       }
    //     });
    //   } else {
    //     cb();
    //   }
    // });
    cb(this.convert(Errors.GENERAL_FAILURE));
  }

  public stat(path: string, isLstat: boolean, cb: BFSCallback<Stats>): void {
    // Ignore lstat case -- Dropbox doesn't support symlinks
    // Stat the file
    this._client.stat(path, (error, stat) => {
      if (error) {
        cb(this.convert(error.message, path));
        // } else if (stat && stat.isRemoved) {
        //   // Dropbox keeps track of deleted files, so if a file has existed in the
        //   // past but doesn't any longer, you wont get an error
        //   cb(ApiError.FileError(ErrorCode.ENOENT, path));
      } else {
        const stats = new Stats(
          this._statType(stat!),
          parseInt(stat!.size),
          parseInt(stat!.mode),
          new Date(parseInt(stat!.atime) * 1000),
          new Date(parseInt(stat!.atime) * 1000),
          new Date(parseInt(stat!.ctime) * 1000),
        );
        return cb(null, stats);
      }
    });
  }

  public open(path: string, flags: FileFlag, mode: number, cb: BFSCallback<File>): void {
    // Try and get the file's contents
    this._client.readFile(path, (error, content, dbStat) => {
      if (error) {
        // If the file's being opened for reading and doesn't exist, return an
        // error
        if (flags.isReadable()) {
          cb(this.convert(error.message, path));
        } else {
          switch (error.message) {
            // If it's being opened for writing or appending, create it so that
            // it can be written to
            case "GENERAL_FAILURE":
              const ab = new ArrayBuffer(0);
              return this._writeFileStrict(path, ab, (error2: ApiError, stat?: RealFsStat) => {
                if (error2) {
                  cb(error2);
                } else {
                  const file = this._makeFile(path, flags, stat!, arrayBuffer2Buffer(ab));
                  cb(null, file);
                }
              });
            default:
          return cb(this.convert(error.message, path));
          }
        }
      } else {
        // No error
        let buffer: Buffer;
        // Dropbox.js seems to set `content` to `null` rather than to an empty
        // buffer when reading an empty file. Not sure why this is.
        if (content === null) {
          buffer = emptyBuffer();
        } else {
          buffer = arrayBuffer2Buffer(content!);
        }
        const file = this._makeFile(path, flags, dbStat!, buffer);
        return cb(null, file);
      }
    });
  }

  public _writeFileStrict(p: string, data: ArrayBuffer, cb: BFSCallback<RealFsStat>): void {
    const parent = path.dirname(p);
    this.stat(parent, false, (error: ApiError, stat?: Stats): void => {
      if (error) {
        cb(ApiError.FileError(ErrorCode.ENOENT, parent));
      } else {
        this._client.writeFile(p, data, (error2, stat) => {
          if (error2) {
            cb(this.convert(error2.message, p));
          } else {
            cb(null, stat);
          }
        });
      }
    });
  }

  /**
   * Private
   * Returns a BrowserFS object representing the type of a Dropbox.js stat object
   */
  public _statType(stat: RealFsStat): FileType {
    return parseInt(stat.itemType);
  }

  /**
   * Private
   * Returns a BrowserFS object representing a File, created from the data
   * returned by calls to the Dropbox API.
   */
  public _makeFile(path: string, flag: FileFlag, stat: RealFsStat, buffer: Buffer): RealFile {
    // const type = /*this._statType(stat); TODO*/ FileType.FILE;
    const type = this._statType(stat);
    const stats = new Stats(type, parseInt(stat.size));
    return new RealFile(this, path, flag, stats, buffer);
  }

  /**
   * Private
   * Delete a file or directory from Dropbox
   * isFile should reflect which call was made to remove the it (`unlink` or
   * `rmdir`). If this doesn't match what's actually at `path`, an error will be
   * returned
   */
  public _remove(path: string, cb: BFSOneArgCallback, isFile: boolean): void {
    this._client.stat(path, (error, stat) => {
      if (error) {
        cb(this.convert(error.message, path));
      } else {
        if (this._statType(stat!) == FileType.FILE && !isFile) {
          cb(ApiError.FileError(ErrorCode.ENOTDIR, path));
        } else if (!(this._statType(stat!) == FileType.FILE) && isFile) {
          cb(ApiError.FileError(ErrorCode.EISDIR, path));
        } else {
          this._client.remove(path, (error) => {
            if (error) {
              cb(this.convert(error.message, path));
            } else {
              cb(null);
            }
          });
        }
      }
    });
  }

  /**
   * Delete a file
   */
  public unlink(path: string, cb: BFSOneArgCallback): void {
    this._remove(path, cb, true);
  }

  /**
   * Delete a directory
   */
  public rmdir(path: string, cb: BFSOneArgCallback): void {
    this._remove(path, cb, false);
  }

  /**
   * Create a directory
   */
  public mkdir(p: string, mode: number, cb: BFSOneArgCallback): void {
    // Dropbox.js' client.mkdir() behaves like `mkdir -p`, i.e. it creates a
    // directory and all its ancestors if they don't exist.
    // Node's fs.mkdir() behaves like `mkdir`, i.e. it throws an error if an attempt
    // is made to create a directory without a parent.
    // To handle this inconsistency, a check for the existence of `path`'s parent
    // must be performed before it is created, and an error thrown if it does
    // not exist
    const parent = path.dirname(p);
    this._client.stat(parent, (error, stat) => {
      if (error) {
        cb(this.convert(error.message, parent));
      } else {
        this._client.mkdir(p, (error) => {
          if (error) {
            cb(ApiError.FileError(ErrorCode.EEXIST, p));
          } else {
            cb(null);
          }
        });
      }
    });
  }

  /**
   * Get the names of the files in a directory
   */
  public readdir(path: string, cb: BFSCallback<string[]>): void {
    this._client.readdir(path, (error, files) => {
      if (error) {
        return cb(this.convert(error.message));
      } else {
        return cb(null, files);
      }
    });
  }

  /**
   * Converts a Dropbox-JS error into a BFS error.
   */
  public convert(err: string, path: string | null = null): ApiError {
    let errorCode = errorCodeLookup[err];
    if (errorCode === undefined) {
      errorCode = ErrorCode.EIO;
    }

    if (!path) {
      return new ApiError(errorCode);
    } else {
      return ApiError.FileError(errorCode, path);
    }
  }
}
