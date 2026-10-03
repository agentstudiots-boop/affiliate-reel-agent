const zlib=require('node:zlib');
function pngFixture(){
  const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
  const chunk=(type,data)=>{const inner=Buffer.concat([Buffer.from(type),data]);let crc=-1;for(const byte of inner)crc=table[(crc^byte)&255]^(crc>>>8);const len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE((crc^-1)>>>0);return Buffer.concat([len,inner,check])};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1024);ihdr.writeUInt32BE(1280,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.alloc(1280*(1+1024*3)))),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={pngFixture};
