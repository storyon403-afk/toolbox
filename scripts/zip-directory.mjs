import { ZipFile } from 'yazl';
import { readdir, lstat, readlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
export async function zipDirectory(directory, destination) {
  const zip = new ZipFile();
  const completed = new Promise((resolve,reject) => { zip.outputStream.on('error',reject);const output=createWriteStream(destination);output.on('error',reject);output.on('close',resolve);zip.outputStream.pipe(output); });
  async function visit(folder,prefix='') {
    for (const entry of await readdir(folder,{withFileTypes:true})) {
      const file=path.join(folder,entry.name),name=prefix+entry.name,info=await lstat(file);
      if(entry.isDirectory())await visit(file,name+'/');
      else if(entry.isSymbolicLink())zip.addBuffer(Buffer.from(await readlink(file)),name,{mode:info.mode});
      else if(entry.isFile())zip.addFile(file,name,{mode:info.mode,compress:!name.endsWith('.bin')});
    }
  }
  await visit(directory);zip.end();await completed;
}
