import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const image = process.argv[2] || 'yoyo:test';
const platform = process.env.SMOKE_PLATFORM || 'linux/amd64';
const docker = (...args) => execFileSync('docker', args, { encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
for (const [index, origin] of ['https://one.example.test','https://two.example.test','https://preview.example.test'].entries()) {
  const indexable=index !== 2;
  const name=`yoyo-smoke-${process.pid}-${index}`;
  try {
    docker('run','-d','--rm','--platform',platform,'--name',name,'-p','127.0.0.1::3000','-e',`SITE_URL=${origin}`,'-e',`SITE_INDEXABLE=${indexable}`,image);
    const port=JSON.parse(docker('inspect',name))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort;
    const base=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let attempt=0;attempt<60;attempt++) {
      try { if((await fetch(base+'/api/health')).ok){ready=true;break;} } catch {}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.ok(ready,'Container did not start');
    const xml=await (await fetch(base+'/sitemap.xml')).text();
    assert.equal((xml.match(/<loc>/g)||[]).length,indexable ? 28 : 0);
    if(indexable) assert.ok(xml.includes(origin));
    const robots=await (await fetch(base+'/robots.txt')).text();
    assert.ok(indexable ? robots.includes(`${origin}/sitemap.xml`) : robots.includes('Disallow: /'));
    for(const locale of ['zh-TW','en']) {
      const html=await (await fetch(base+`/${locale}/tools/word-count`)).text();
      assert.ok(html.includes(`${origin}/${locale}/tools/word-count`));
      assert.ok(html.includes(`<html lang="${locale}"`));
      if(!indexable) assert.ok(html.includes('noindex, nofollow'));
      const share=await fetch(base+`/${locale}/share-image`);
      assert.equal(share.headers.get('content-type'),'image/png');
      assert.equal(share.status,200);
      const png=new Uint8Array(await share.arrayBuffer());
      assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);
      const dimensions=new DataView(png.buffer,png.byteOffset,png.byteLength);
      assert.equal(dimensions.getUint32(16),1200);
      assert.equal(dimensions.getUint32(20),630);
    }
    assert.equal(docker('exec',name,'id','-u'),'1001');
    docker('exec',name,'node','scripts/healthcheck.mjs');
    console.log(`${platform}: ${origin} passed`);
  } catch(error) {
    try { console.error(docker('logs',name)); } catch {}
    throw error;
  } finally { try { docker('stop','-t','10',name); } catch {} }
}
// A public-domain setting is mandatory; a missing one must fail at startup.
const invalid=`yoyo-invalid-${process.pid}`;
try {
  docker('create','--platform',platform,'--name',invalid,image);
  try { docker('start','-a',invalid); } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert.equal(JSON.parse(docker('inspect',invalid))[0].State.ExitCode,1);
} finally { try { docker('rm','-f',invalid); } catch {} }
