#!/usr/bin/env node
import path from 'path';
import { readFile,readFileSync, writeFile, writeFileSync, existsSync, lstatSync } from "fs";
import { exec } from "child_process";

import { hashElement } from "./folder-hash.mjs";
import { Version } from "./version.mjs";


function dependencyMap(outputFile) {
  let depends = readFileSync(outputFile,"utf8");
  depends = JSON.parse(depends).graph.dependencies;
  let keys = Object.keys(depends);
  let inverted = {};
  for(let i=0;i<keys.length;i++) {
    let name = keys[i];
    let p = depends[name];
    for(let j=0;j<p.length;j++) {
      var d = p[j];
      inverted[d.target] = inverted[d.target]||[];
      inverted[d.target].push(name);
    }
  }
  return inverted;
}


function buildResult(packageFolder, name,last_version,status,options) {
  if(options.debug) console.log(packageFolder, name,`- ${status}`);
  if(options.version) {
    let version_file = path.join(options.prefixPath, packageFolder,name,"package.json");
    return Version(name,last_version,version_file, options,{"name":name,changed:(status!="UNCHANGED"),status,packageFolder});
  } else {
    return new Promise((resolve, reject) => {
      resolve({"name":name,changed:(status!="UNCHANGED"),status,packageFolder});
    });
  }
}

function getCurrentVersion(pathPrefix,packageFolder, name) {
  const projectFile = path.join(pathPrefix, packageFolder,name,"package.json");

  if(!existsSync(projectFile)) return {"version":"0.0.0"};
  let data = readFileSync(projectFile, "utf8")
  let pkg = JSON.parse(data);
  return {version:pkg.version,fullName:pkg.name,packageFolder};
}

async function updateVersion(packageFolder,name,version) {
  var value = new Promise((resolve, reject) => {
    const projectFile = path.join(options.prefixPath, packageFolder,name,"package.json");
    if(!existsSync(projectFile)) return resolve("NOT FOUND");

    readFile(projectFile, "utf8", (error, data) => {
      if (error) {
        console.log(error);
        reject(error);
        return;
      }
      let versionFile = JSON.parse(data);
      if(versionFile["version"]!==version) {
        versionFile["version"] = version;
        writeFile(projectFile, JSON.stringify(versionFile, null, 2), "utf8",
            (error) => {
              if (error) {
                console.log(error);
                reject(error);
                return;
              }
              resolve("OK");
            });
      } else resolve("NOT NEEDED");
    });

  });

  return value;
}


async function compare(packageFolder, previous,current,dependencies,options) {
  let packages = Object.keys(current);
  let plist = [];
  let nameMap = {};

  packages.forEach((name) => {
    let fullName = current[name].fullName;
    nameMap[fullName] = name;
  });

  packages.forEach((name) => {
    let fullName = current[name].fullName;
    if(current[name].packageFolder!==packageFolder) return;
    if(previous[name]===undefined) {
      plist.push(buildResult(packageFolder,name,current[name].version,"NEW",options));
    } else {
      if(current[name].hash!==previous[name].hash) {
        plist.push(buildResult(packageFolder,name,current[name].version,"CHANGED",options));
        if(dependencies[fullName] && dependencies[fullName].length>0) {
          let d = dependencies[fullName];
          for(let i=0;i<d.length;i++) {
            let depName = nameMap[d[i]];
            plist.push(buildResult(packageFolder,depName,current[depName].version,"CHANGED",options));
          }
        }
      } else {
        plist.push(buildResult(packageFolder,name,current[name].version,"UNCHANGED",options));
      }
    }
  });
  return Promise.allSettled(plist);
}

async function main(options) {
  return new Promise((mainResolve, mainreject) => {
    const hashOptions = { encoding: 'hex', folders: { exclude: options.hashExcludeFolders }, files: { exclude: options.hashExcludeFiles } }
    const current = {};
    const changeList = [];
    const scanlist = [];

    options.children.split(',').forEach((packageFolder)=>{
      scanlist.push(new Promise((resolve, reject) => {
        hashElement(path.join(options.prefixPath,packageFolder), hashOptions).then(async hash => {
          // calculate latest folder hashes
          const children = hash.children;
          for(let i=0;i<children.length;i++)
          {
            let name = children[i].name;
            if(name.substring(0,1)==="_" || name==="version" ) continue;
            if(lstatSync(path.join( options.prefixPath, packageFolder,name)).isFile()) continue;
            if(!existsSync(path.join( options.prefixPath, packageFolder,name))) continue;

            delete children[i].children;
            let v = getCurrentVersion(options.prefixPath,packageFolder,name);
            current[name]={hash:children[i].hash,...v};
          }

          const changeConfig = path.join(options.prefixPath,options.hashFile);
          let previous = {};

          // make sure hash config file exits
          if(!existsSync(changeConfig)) {
            writeFileSync(changeConfig, "{}", "utf8");
          }

          // load previous hashes
          readFile(changeConfig, "utf8", async (error, data) => {
            if (error) {
              console.log(error);
              reject(error);
              return;
            }
            previous=JSON.parse(data);

            if(options.changed || options.version) {

              let dependencies={};
              if(options.dependencies) {
                if(existsSync(options.dependencies)) {
                  dependencies = dependencyMap(options.dependencies);
                  if(options.debug) console.log('Loaded dependencies\n',JSON.stringify(dependencies));
                } else {
                  console.log('\x1b[33m%s\x1b[0m', `Could not load dependency file ${options.dependencies}`);
                }
              }

              let results = await compare(packageFolder, previous,current,dependencies,options);
              if(options.debug) console.log(JSON.stringify(results));

              for(let i=0;i<results.length;i++) {
                if(results[i].value.changed)
                  changeList.push(results[i].value.name)
              }

              let plist=[];
              for(let i=0;i<results.length;i++) {
                if(results[i].value.packageFolder!==packageFolder) continue;
                if(options.version) {
                  if(options.debug) console.log(results[i]);
                  let safeName = results[i].value.name;
                  safeName = safeName.replace(/-/g, '').replace(/_/g, '').replace(/\./g, '');
                  if(results[i].value.changed) {
                    console.log(`##vso[task.setvariable variable=${safeName};isoutput=true;]${results[i].value.version}`);
                    if(options.saveVersion) {
                      plist.push(updateVersion(packageFolder,results[i].value.name,results[i].value.version));
                    }
                  } else {
                    console.log(`##vso[task.setvariable variable=${safeName};isoutput=true;]${results[i].value.previous}`);
                  }
                }
                if(options.tag) {
                  plist.push(new Promise((resolve,reject)=>{
                    let rev=results[i].value.name+'@'+results[i].value.version;
                    exec(`git describe --tags ${rev}`, (err, tag, stderr) => {
                      if (err) {
                          exec(`git tag ${rev} -m "${rev}"`, (err, tag, stderr) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve(rev);
                          });
                          return;
                      }
                    });
                  }));
                }
              }
              if(plist.length>0 && options.debug) {
                console.log(await Promise.allSettled(plist));
              }
            }

            // write current hashes
            if(options.hash) {
              let names = Object.keys(current);
              for(let i=0;i<names.length;i++) {
                if(current[names[i]].packageFolder!==packageFolder) continue;
                let v = getCurrentVersion(options.prefixPath,packageFolder,names[i]);
                current[names[i]].version = v.version;
                current[names[i]].fullName = v.fullName;
              }

              writeFileSync(changeConfig, JSON.stringify(current, null, 2), "utf8");
              console.log('folder hashes written successfully');
            }

            resolve("OK");
          });
        })
        .catch(error => {
          return console.error('hashing failed:', error);
        });
      }));
    });

    Promise.all(scanlist).then(()=>{
      if(options.changed) {
        console.log(`CHANGED - ${JSON.stringify(changeList)}`);
        console.log(`##vso[task.setvariable variable=changed;isoutput=true]${JSON.stringify(changeList)}`);
      }

      mainResolve("DONE");
    },mainreject);
  });
}

let options = {
    saveVersion:false,
    changed:false,
    version:false,
    hash:false,
    tag:false,
    commit:false,
    // push:false,
    children:"packages",
    prefixPath:'./',
    debug:false,
    hashFile:".cicd/hash.json",
    hashExcludeFolders:['node_modules', 'coverage', 'dist'],
    hashExcludeFiles:['.npmrc','CHANGELOG.md','README.md'],
    dependencies:"dependencies.json"
};

if (process.argv.length === 2) {
  console.error('Expected at least one argument!');
  process.exit(1);
} else {
  let argv = process.argv;
  for(let i=2;i<argv.length;i++) {
    if(argv[i]==="--save") options.saveVersion=true;
    else if(argv[i]==="--debug") options.debug=true;
    else if(argv[i]==="--changed") options.changed=true;
    else if(argv[i]==="--version") options.version=true;
    else if(argv[i]==="--hash") options.hash=true;
    else if(argv[i]==="--tag") options.tag=true;
    else if(argv[i]==="--hashExcludeFolders" || argv[i]==="--hashExcludeFiles") {
      let name = argv[i].substring(2);
      options[name] = argv[i+1].split(',');
      i++;
    } else
    if(argv[i].substring(0,2)==="--") {
      let name = argv[i].substring(2);
      if(options[name]!==undefined) {
          options[name] = argv[i+1];
          i++;
      } else {
          console.error(`Expected a known option, got ${argv[i]}`);
          process.exit(1);
      }
    }
  }
}

(async () => {
  try {
      const text = await main(options);
      console.log(text);
  } catch (e) {
      console.log(e);
      process.exit(1);
  }
})();
