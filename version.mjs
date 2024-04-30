import * as url from 'url';
import fs from "fs";
import { exec } from "child_process";

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const processMessage = function(message,tag,imageName, options, args) {
    let previous = tag;
    let parts = tag.split('@');
    if(parts.length>1) tag=parts[1];
    let suffix = tag.trim().split('-');
    if(suffix.length>0) {
      tag=suffix[0];
      suffix=suffix[1];
    } else suffix=false;

    parts = tag.trim().split('.');
    parts.length = 3;
    let build = false;

    console.log("PROCESS -",imageName,tag,message)

    if (message.indexOf("fix:") >= 0 || message==='') {
        parts[2] = parseInt(parts[2]);
        parts[2]++;
        build = true;
    }
    if (message.indexOf("feat:") >= 0) {
        parts[1] = parseInt(parts[1]);
        parts[1]++;
        parts[2] = 0;
        build = true;
    }
    if (message.indexOf("BREAKING") >= 0) {
        parts[0] = parseInt(parts[0]);
        parts[0]++;
        parts[1] = '0';
        parts[2] = '0';
        build = true;
    }

    tag = parts.join('.');
    if(suffix) tag=tag+'-'+suffix;

    if(options.debug) console.log('\x1b[32m%s\x1b[0m', `Next version: ${imageName}@${tag}`);
    return {"name":imageName, "tag":tag,"version":tag, build, previous, ...args};
};

async function Version(imageName, last_version, version_file, options, args)
{

    const readConfig = function(resolve, reject) {
        try {
            if(options.debug) console.log('\x1b[32m%s\x1b[0m', `reading config: ${version_file}`);

            let data = fs.readFileSync(version_file, 'utf8');
            let tag = JSON.parse(data).version;
            tag = tag.trim();
            if(options.debug) console.log('\x1b[32m%s\x1b[0m', `Found version: ${imageName}@${tag}`);
            resolve(processMessage("fix: no version tag found", tag, imageName, options, args));
        } catch {
            if(options.debug) console.log('\x1b[33m%s\x1b[0m', 'Could not find last or next version: ');
            resolve({"name":imageName,"tag":`${imageName}@0.0.0`,"previous":"0.0.0","version":"0.0.1", ...args});
        }
    };

    // if(args.changed)
    //     return new Promise((resolve, reject) => {
    //         let cmd= `git log ${imageName}/${last_version}..HEAD --oneline -- packages/spinner --no-merges`;
    //         exec(cmd, (err, message, stderr) => {
    //             if (err) {
    //                 console.log('\x1b[33m%s\x1b[0m', 'Could not find any revisions because: ');
    //                 console.log('\x1b[31m%s\x1b[0m', stderr);
    //                 console.log('\x1b[31m%s\x1b[0m', cmd);

    //                 readConfig(resolve, reject);

    //                 return;
    //             }
    //             resolve(processMessage(message, last_version, imageName, options, args));
    //         });
    //     });

    return new Promise((resolve, reject) => {
        readConfig(resolve, reject)
    });
}

export { Version };
