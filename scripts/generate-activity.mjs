import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const user = 'fwlipebueno';
const profile = 'https://github.com/fwlipebueno#js-contribution-activity';
const dayMs = 86_400_000;
const days = 84;
const file = (name) => fileURLToPath(new URL('../' + name, import.meta.url));
const iso = (time) => new Date(time).toISOString().slice(0, 10);
const palettes={
  dark:{back:'#161b2b',edge:'#3b445f',ink:'#ecedf4',sub:'#c2c6da',grid:'#324161',stem:'#859ee2',node:'#a9bafc',hot:'#f1bb9f',quiet:'#677791'},
  light:{back:'#f0eff4',edge:'#c7cada',ink:'#192238',sub:'#3b4867',grid:'#c6cde3',stem:'#6374ae',node:'#435dae',hot:'#8c4d37',quiet:'#909ab8'},
};

function dateMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid calendar date');
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || iso(time) !== value) throw new Error('Invalid calendar date');
  return time;
}

function validate(data) {
  if (data?.user !== user || data.source !== profile) throw new Error('Mismatched calendar owner or source');
  if (dateMs(data.to) - dateMs(data.from) !== (days - 1) * dayMs) throw new Error('Expected 84 consecutive days');
  if (!Array.isArray(data.counts) || data.counts.length !== days ||
      data.counts.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error('Expected one non-negative count per day');
  }
  return data;
}

async function fetchSnapshot() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for workflow refresh');
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - dayMs;
  const start = end - (days - 1) * dayMs;
  const query = 'query($who:String!,$from:DateTime!,$to:DateTime!){user(login:$who){login contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}';
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ query, variables: {
      who: user, from: new Date(start).toISOString(), to: new Date(end + dayMs - 1).toISOString(),
    } }),
  });
  if (!response.ok) throw new Error('GitHub calendar request failed: ' + response.status);
  const payload = await response.json();
  const account = payload.data?.user;
  const weeks = account?.contributionsCollection?.contributionCalendar?.weeks;
  if (payload.errors?.length || account?.login !== user || !Array.isArray(weeks)) {
    throw new Error('GitHub did not return a calendar for this account');
  }
  const countsByDate = new Map();
  for (const week of weeks) {
    for (const { date, contributionCount } of week.contributionDays) {
      if (countsByDate.has(date)) throw new Error('GitHub returned a duplicate day');
      countsByDate.set(date, contributionCount);
    }
  }
  const counts = Array.from({ length: days }, (_, i) => countsByDate.get(iso(start + i * dayMs)));
  return validate({ user, source: profile, from: iso(start), to: iso(end), counts });
}

function render(data,p) {
  const epoch=dateMs(data.from);
  // The constant fold is the projection plane. Only the height above each
  // local base, and the marker size, depend on the contribution count.
  const base=(col,row)=>17 * Math.sin((col-2)*Math.PI/14) + 6*Math.sin(row*Math.PI/6);
  const coords=(col,row,z=0)=>[247+col*31+row*19,70+col*1.8+row*12.5-base(col,row)-z];
  const coord=(col,row,z=0)=>coords(col,row,z).map(n=>n.toFixed(2)).join(' ');
  const rail=(steps,point)=>Array.from({length:steps+1},(_,i)=>(i?'L':'M')+point(i)).join('');
  const grid=[];
  for(let i=0;i<=11;i++) grid.push('<path d="'+rail(18,j=>coord(i,j/3))+'" opacity=".56"/>');
  for(let j=0;j<=6;j++) grid.push('<path d="'+rail(44,i=>coord(i/4,j))+'"/>');
  const top=rail(44,i=>coord(i/4,0));
  const front=rail(44,i=>coord(11-i/4,6)).replace(/^M/,'L');
  const right=rail(18,j=>coord(11,j/3)).replace(/^M/,'L');
  const left=rail(18,j=>coord(0,6-j/3)).replace(/^M/,'L');
  const points=data.counts.map((n,i)=>{
    const col=Math.floor(i/7),row=i%7;
    const h=n?Math.min(41,11+14*Math.log2(n)):0;
    const paint=n>=3?p.hot:n?p.node:p.quiet;
    const [x,y]=coords(col,row,h);
    const label=iso(epoch+i*dayMs)+' · '+n;
    return '<g data-count="'+n+'" data-height="'+h.toFixed(2)+'"><title>'+label+'</title>'+
      (n?'<path d="M'+coord(col,row)+'L'+coord(col,row,h)+'" stroke="'+p.stem+'" stroke-width="1.35"/><ellipse cx="'+x.toFixed(2)+'" cy="'+(y+1).toFixed(2)+'" rx="'+Math.min(6,2.1+n*.8).toFixed(2)+'" ry="3.2" fill="url(#point)" stroke="'+paint+'" stroke-width="1.1"/>':'<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="1.8" fill="'+paint+'"/>')+'</g>';
  }).join('\n');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="188" viewBox="0 0 750 188">',
    '<title>Activity surface · '+data.from+' to '+data.to+'</title>',
    '<desc>84 complete days of public GitHub activity. The folded surface is a visual baseline. Only the height above it and size encode the daily contribution count.</desc>',
    '<defs><linearGradient id="fold" x1="0%" y1="0%" x2="100%" y2="85%"><stop stop-color="'+p.node+'" stop-opacity=".14"/><stop offset=".55" stop-color="'+p.stem+'" stop-opacity=".05"/><stop offset="1" stop-color="'+p.hot+'" stop-opacity=".16"/></linearGradient><linearGradient id="point" x2="0%" y2="100%"><stop stop-color="'+p.ink+'" stop-opacity=".8"/><stop offset="1" stop-color="'+p.node+'" stop-opacity=".33"/></linearGradient></defs>',
    '<rect x=".5" y=".5" width="749" height="187" rx="11" fill="'+p.back+'" stroke="'+p.edge+'"/>',
    '<path d="M218 27v131" stroke="'+p.edge+'"/>',
    '<path d="M27 48c8-8 12-8 17 0 5 7 10 6 20-5" fill="none" stroke="'+p.hot+'" stroke-width="1.6" stroke-linecap="round"/>',
    '<g fill="'+p.ink+'" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="650"><text x="23" y="84">Activity surface</text></g>',
    '<g fill="'+p.sub+'" font-family="Consolas,monospace" font-size="17"><text x="25" y="113">'+data.from+'</text><text x="25" y="135">— '+data.to+'</text></g>',
    '<path d="'+top+right+front+left+'Z" fill="url(#fold)" stroke="'+p.stem+'" stroke-opacity=".38"/>',
    '<g fill="none" stroke="'+p.grid+'" stroke-width="1">'+grid.join('')+'</g>',
    points,
    '</svg>', '',
  ].join('\n');
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== '--refresh')) throw new Error('Usage: node scripts/generate-activity.mjs [--refresh]');
const refresh = args[0] === '--refresh';
const data = refresh ? await fetchSnapshot() : validate(JSON.parse(await readFile(file('data/contributions.json'), 'utf8')));
const output = refresh ? 'contribution-preview/' : '';
await mkdir(file(output + 'assets/'), { recursive: true });
if (refresh) {
  await mkdir(file(output + 'data/'), { recursive: true });
  await writeFile(file(output + 'data/contributions.json'), JSON.stringify(data, null, 2) + '\n');
}
for (const [mode, palette] of Object.entries(palettes)) {
  await writeFile(file(output + 'assets/activity-' + mode + '.svg'), render(data, palette));
}
console.log('Rendered ' + days + ' days of GitHub activity (' + data.from + ' to ' + data.to + ').');
