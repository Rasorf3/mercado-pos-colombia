import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CredentialVault { read():string|null; write(token:string):void }
export function encryptedCredentialVault(path:string):CredentialVault {
  const available=()=>{if(!safeStorage.isEncryptionAvailable() || (process.platform==="linux" && safeStorage.getSelectedStorageBackend()==="basic_text")) throw new Error("El sistema operativo no dispone de almacenamiento seguro para vincular esta caja.");};
  return {
    read:()=>{if(!existsSync(path))return null;available();return safeStorage.decryptString(readFileSync(path));},
    write:(token)=>{available();mkdirSync(dirname(path),{recursive:true});const temporary=`${path}.tmp`;writeFileSync(temporary,safeStorage.encryptString(token));renameSync(temporary,path);}
  };
}
