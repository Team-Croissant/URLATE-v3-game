/* eslint-disable @typescript-eslint/no-var-requires */
import * as redis from "redis";
import * as fetch from "node-fetch";
import * as fs from "fs";

const config = require(__dirname + "/../config/config.json");

const { Signale } = require("signale");

const options = {
  disabled: false,
  interactive: false,
  stream: process.stdout,
  types: {
    start: {
      badge: "▶",
      color: "green",
      label: "Start",
      logLevel: "info",
    },
    stop: {
      badge: "■",
      color: "red",
      label: "Stop",
      logLevel: "info",
    },
  },
};

const signale = new Signale(options);

const redisClient = redis.createClient(config.database.redis);

const io = require("socket.io")(config.project.port);

const patternDir = __dirname + "/../URLATE-patterns/";

const getPatternDir = (name, difficulty) => {
  return `${name}/${difficulty}.json`;
};

const redisGet = (key) => {
  return new Promise((resolve) => {
    redisClient.get(key, (err, data) => {
      resolve(data);
    });
  });
};

const redisSGet = (key): Promise<number[]> => {
  return new Promise((resolve) => {
    redisClient.smembers(key, (err, data) => {
      resolve(data);
    });
  });
};

const getTan = (deg) => {
  const rad = (deg * Math.PI) / 180;
  return Math.tan(rad);
};

const calcAngleDegrees = (x, y) => {
  return (Math.atan2(y, x) * 180) / Math.PI;
};

const lowerBound = (array, value) => {
  if (value < 0) value = 0;
  let low = 0;
  let high = array.length;
  while (low < high) {
    const mid = Math.floor(low + (high - low) / 2);
    if (value <= array[mid].ms) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
};

const upperBound = (array, value) => {
  let low = 0;
  let high = array.length;
  while (low < high) {
    const mid = Math.floor(low + (high - low) / 2);
    if (value >= array[mid].ms) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

const calculateScore = async (judge, id) => {
  if (judge == "miss") {
    let miss = await Number(await redisGet(`miss${id}`));
    miss++;
    redisClient.set(`combo${id}`, 0);
    redisClient.set(`miss${id}`, miss);
    return;
  } else if (judge == "bullet") {
    let bullet = await Number(await redisGet(`bullet${id}`));
    bullet++;
    redisClient.set(`combo${id}`, 0);
    redisClient.set(`bullet${id}`, bullet);
    return;
  }
  const patternLength = await Number(await redisGet(`patternLength${id}`));
  const rate = await Number(await redisGet(`rate${id}`));
  let score = await Number(await redisGet(`score${id}`));
  let combo = await Number(await redisGet(`combo${id}`));
  let perfect = await Number(await redisGet(`perfect${id}`));
  let great = await Number(await redisGet(`great${id}`));
  let good = await Number(await redisGet(`good${id}`));
  let bad = await Number(await redisGet(`bad${id}`));
  combo++;
  const basicScore = 100000000 / patternLength;
  const rateCalc = rate * 0.5 + 0.5;
  if (judge == "perfect") {
    score += Math.round((basicScore + combo * 5) * rateCalc);
    perfect++;
  } else if (judge == "great") {
    score += Math.round((basicScore * 0.5 + combo * 5) * rateCalc);
    great++;
  } else if (judge == "good") {
    score += Math.round((basicScore * 0.2 + combo * 3) * rateCalc);
    good++;
  } else {
    bad++;
    combo = 0;
    score += Math.round(basicScore * 0.05 * rateCalc);
  }
  redisClient.set(`combo${id}`, combo);
  redisClient.set(`score${id}`, score);
  redisClient.set(`perfect${id}`, perfect);
  redisClient.set(`great${id}`, great);
  redisClient.set(`good${id}`, good);
  redisClient.set(`bad${id}`, bad);
};

redisClient.on("error", function (error) {
  signale.error(error);
});

io.on("connection", (socket) => {
  redisClient.set(`socket${socket.id}`, socket.handshake.query.id);
  redisClient.set(`user${socket.id}`, socket.handshake.query.name);

  socket.on("game init", async (name, difficulty, rate, patternId) => {
    const isUserConnected = await redisGet(`score${socket.id}`);
    if (isUserConnected === null) {
      signale.success(`${socket.id} : Game Initialized`);
      if (patternId) {
        fetch(`${config.project.cdn}/CPL/${patternId}.json`, {
          method: "GET",
          credentials: "include",
          headers: {
            Authorization: config.project.auth,
          },
        })
          .then((res) => res.json())
          .then((data) => {
            signale.warn(`${socket.id} : CPL detected.`);
            redisClient.set(`pattern${socket.id}`, JSON.stringify(data));
            redisClient.set(`patternId${socket.id}`, patternId);
            redisClient.set(`bpm${socket.id}`, data.information.bpm);
            redisClient.set(`speed${socket.id}`, data.information.speed);
            redisClient.set(`patternLength${socket.id}`, data.patterns.length);
            redisClient.set(`name${socket.id}`, data.information.track);
          });
      } else {
        fs.readFile(patternDir + getPatternDir(name, difficulty), "utf8", (err, file) => {
          const data = JSON.parse(file);
          redisClient.set(`pattern${socket.id}`, file);
          redisClient.set(`bpm${socket.id}`, data.information.bpm);
          redisClient.set(`speed${socket.id}`, data.information.speed);
          redisClient.set(`patternLength${socket.id}`, data.patterns.length);
          redisClient.set(`name${socket.id}`, data.information.track);
        });
      }
      redisClient.set(`rate${socket.id}`, rate);
      redisClient.set(`difficulty${socket.id}`, difficulty);
      redisClient.set(`score${socket.id}`, 0);
      redisClient.set(`combo${socket.id}`, 0);
      redisClient.set(`perfect${socket.id}`, 0);
      redisClient.set(`great${socket.id}`, 0);
      redisClient.set(`good${socket.id}`, 0);
      redisClient.set(`bad${socket.id}`, 0);
      redisClient.set(`miss${socket.id}`, 0);
      redisClient.set(`bullet${socket.id}`, 0);
      redisClient.del(`destroyedBullets${socket.id}`);
      redisClient.del(`destroyedNotes${socket.id}`);
    } else {
      signale.warn(`${socket.id} : User Reconnected.`);
    }
  });

  socket.on("game resized", (width, w, h) => {
    redisClient.set(`width${socket.id}`, width);
    redisClient.set(`w${socket.id}`, w);
    redisClient.set(`h${socket.id}`, h);
    signale.warn(`${socket.id} : Window Resized`);
  });

  socket.on("game start", (date, width, w, h) => {
    redisClient.set(`ms${socket.id}`, date);
    redisClient.set(`width${socket.id}`, width);
    redisClient.set(`w${socket.id}`, w);
    redisClient.set(`h${socket.id}`, h);
    signale.start(`${socket.id} : Game Started`);
  });

  socket.on("game pause", (date) => {
    redisClient.set(`pauseDate${socket.id}`, date);
    signale.stop(`${socket.id} : Game Paused`);
  });

  socket.on("game resume", async (date) => {
    const pauseDate = await redisGet(`pauseDate${socket.id}`);
    const ms = await redisGet(`ms${socket.id}`);
    redisClient.set(`ms${socket.id}`, Number(ms) + date - Number(pauseDate));
    signale.start(`${socket.id} : Game Resume`);
  });

  socket.on("game update", async (x, y, offset, date) => {
    const pattern = await JSON.parse(`${await redisGet(`pattern${socket.id}`)}`);
    try {
      const rate = Number(await redisGet(`rate${socket.id}`));
      const w = Number(await redisGet(`w${socket.id}`));
      const h = Number(await redisGet(`h${socket.id}`));
      const width = Number(await redisGet(`width${socket.id}`));
      const ms = Number(await redisGet(`ms${socket.id}`));
      let bpm = Number(await redisGet(`bpm${socket.id}`));
      let speed = Number(await redisGet(`speed${socket.id}`));
      let destroyedBullets: number[] = await redisSGet(`destroyedBullets${socket.id}`);
      let destroyedNotes: number[] = await redisSGet(`destroyedNotes${socket.id}`);
      destroyedBullets = destroyedBullets.map(Number);
      destroyedNotes = destroyedNotes.map(Number);
      let circleBulletAngles = await redisGet(`circleBulletAngles${socket.id}`);
      circleBulletAngles = `${circleBulletAngles}`.split(",").map(Number);
      const seek = (date - ms) * rate - offset;
      let start = lowerBound(pattern.triggers, 0);
      let end = upperBound(pattern.triggers, seek);
      const renderTriggers = pattern.triggers.slice(start, end);
      for (let i = 0; i < renderTriggers.length; i++) {
        if (renderTriggers[i].value == 0) {
          if (destroyedBullets.indexOf(renderTriggers[i].num) == -1) {
            await destroyedBullets.push(renderTriggers[i].num);
            redisClient.sadd(`destroyedBullets${socket.id}`, renderTriggers[i].num);
          }
        } else if (renderTriggers[i].value == 1) {
          end = upperBound(pattern.bullets, renderTriggers[i].ms);
          const renderBullets = pattern.bullets.slice(0, end);
          for (let j = 0; renderBullets.length > j; j++) {
            if (destroyedBullets.indexOf(j) == -1) {
              destroyedBullets.push(j);
              redisClient.sadd(`destroyedBullets${socket.id}`, j);
            }
          }
        } else if (renderTriggers[i].value == 2) {
          bpm = renderTriggers[i].bpm;
          redisClient.set(`bpm${socket.id}`, renderTriggers[i].bpm);
        } else if (renderTriggers[i].value == 4) {
          speed = renderTriggers[i].speed;
          redisClient.set(`speed${socket.id}`, renderTriggers[i].speed);
        }
      }
      start = lowerBound(pattern.bullets, seek - bpm * 100);
      end = upperBound(pattern.bullets, seek);
      const renderBullets = pattern.bullets.slice(start, end);
      for (let i = 0; i < renderBullets.length; i++) {
        const e = renderBullets[i];
        if (destroyedBullets.indexOf(start + i) == -1) {
          const p = ((seek - e.ms) / ((bpm * 40) / speed / e.speed)) * 100;
          const left = e.direction == "L";
          const ex = (left ? -1 : 1) * (100 - p);
          let ey = 0;
          if (e.value == 0) {
            ey = e.location + p * getTan(e.angle) * (left ? 1 : -1);
          } else {
            if (!circleBulletAngles[start + i]) {
              circleBulletAngles[start + i] = calcAngleDegrees((left ? -100 : 100) - x, e.location - y);
              redisClient.set(`circleBulletAngles${socket.id}`, circleBulletAngles.toString());
            }
            if (left) {
              if (110 > circleBulletAngles[start + i] && circleBulletAngles[start + i] > 0) circleBulletAngles[start + i] = 110;
              else if (0 > circleBulletAngles[start + i] && circleBulletAngles[start + i] > -110) circleBulletAngles[start + i] = -110;
            } else {
              if (70 < circleBulletAngles[start + i] && circleBulletAngles[start + i] > 0) circleBulletAngles[start + i] = 70;
              else if (0 > circleBulletAngles[start + i] && circleBulletAngles[start + i] < -70) circleBulletAngles[start + i] = -70;
            }
            ey = e.location + p * getTan(circleBulletAngles[start + i]) * (left ? 1 : -1);
          }
          const powX = (x - ex) * w;
          const powY = (y - ey) * h;
          if (Math.sqrt(Math.pow(powX, 2) + Math.pow(powY, 2)) <= width / 80) {
            if (destroyedBullets.indexOf(start + i) == -1) {
              await destroyedBullets.push(start + i);
              redisClient.set(`combo${socket.id}`, 0);
              redisClient.sadd(`destroyedBullets${socket.id}`, start + i);
              signale.warn(`${socket.id} : Bullet`);
              calculateScore("bullet", socket.id);
            }
          }
        }
      }
      start = lowerBound(pattern.patterns, seek - (bpm * 4) / speed);
      end = upperBound(pattern.patterns, seek);
      const renderNotes = pattern.patterns.slice(start, end);
      for (let i = 0; i < renderNotes.length; i++) {
        const p = (((bpm * 14) / speed - (renderNotes[i].ms - seek)) / ((bpm * 14) / speed)) * 100;
        if (p >= 120 && destroyedNotes.indexOf(start + i) == -1) {
          destroyedNotes.push(start + i);
          await redisClient.sadd(`destroyedNotes${socket.id}`, start + i);
          signale.success(`${socket.id} : Miss`);
          calculateScore("miss", socket.id);
        }
      }
    } catch (e) {
      signale.error(e);
      signale.debug(pattern);
    }
  });

  socket.on("game click", async (x, y, offset, date, key, isWheel) => {
    const pattern = await JSON.parse(`${await redisGet(`pattern${socket.id}`)}`);
    try {
      const rate = Number(await redisGet(`rate${socket.id}`));
      const ms = Number(await redisGet(`ms${socket.id}`));
      const bpm = Number(await redisGet(`bpm${socket.id}`));
      const speed = Number(await redisGet(`speed${socket.id}`));
      const seek = (date - ms) * rate - offset;
      const start = lowerBound(pattern.patterns, seek - (bpm * 4) / speed);
      const end = upperBound(pattern.patterns, seek + (bpm * 14) / speed);
      const renderNotes = pattern.patterns.slice(start, end);
      const width = Number(await redisGet(`width${socket.id}`));
      const w = Number(await redisGet(`w${socket.id}`));
      const h = Number(await redisGet(`h${socket.id}`));
      let destroyedNotes: number[] = await redisSGet(`destroyedNotes${socket.id}`);
      destroyedNotes = destroyedNotes.map(Number);
      for (let i = 0; i < renderNotes.length; i++) {
        if (destroyedNotes.indexOf(start + i) == -1) {
          const powX = (x - renderNotes[i].x) * w;
          const powY = (y - renderNotes[i].y) * h;
          const isClickedNote = Math.sqrt(Math.pow(powX, 2) + Math.pow(powY, 2)) <= width / 40 + width / 70;
          const p = (((bpm * 14) / speed - (renderNotes[i].ms - seek)) / ((bpm * 14) / speed)) * 100;
          if (isClickedNote && (renderNotes[i].value == 0) == !isWheel && p >= 50) {
            if (renderNotes[i].value == 1 && renderNotes[i].direction != key) return;
            const perfectJudge = (60000 / bpm / 8) * rate;
            const greatJudge = (60000 / bpm / 5) * rate;
            const goodJudge = (60000 / bpm / 3) * rate;
            const badJudge = (60000 / bpm / 2) * rate;
            const noteMs = renderNotes[i].ms;
            if (seek < noteMs + perfectJudge && seek > noteMs - perfectJudge) {
              signale.success(`${socket.id} : Perfect`);
              calculateScore("perfect", socket.id);
            } else if (seek < noteMs + greatJudge && seek > noteMs - greatJudge) {
              signale.success(`${socket.id} : Great`);
              calculateScore("great", socket.id);
            } else if (seek > noteMs - goodJudge && seek < noteMs) {
              signale.success(`${socket.id} : Good`);
              calculateScore("good", socket.id);
            } else if ((seek > noteMs - badJudge && seek < noteMs) || noteMs < seek) {
              signale.success(`${socket.id} : Bad`);
              calculateScore("bad", socket.id);
            } else {
              signale.success(`${socket.id} : Miss`);
              calculateScore("miss", socket.id);
            }
            redisClient.sadd(`destroyedNotes${socket.id}`, start + i);
            break;
          }
        }
      }
    } catch (e) {
      signale.error(e);
      signale.debug(pattern);
    }
  });

  socket.on("game end", async (maxCombo) => {
    signale.stop(`${socket.id} : Game Finished`);
    const id = await redisGet(`patternId${socket.id}`);
    const name = await redisGet(`name${socket.id}`);
    const user = await redisGet(`user${socket.id}`);
    const difficulty = await Number(await redisGet(`difficulty${socket.id}`));
    const score = await Number(await redisGet(`score${socket.id}`));
    const perfect = await Number(await redisGet(`perfect${socket.id}`));
    const great = await Number(await redisGet(`great${socket.id}`));
    const good = await Number(await redisGet(`good${socket.id}`));
    const bad = await Number(await redisGet(`bad${socket.id}`));
    const miss = await Number(await redisGet(`miss${socket.id}`));
    const bullet = await Number(await redisGet(`bullet${socket.id}`));
    const accuracy = Number((((perfect + (great / 10) * 7 + good / 2 + (bad / 10) * 3) / (perfect + great + good + bad + miss + bullet)) * 100).toFixed(1));
    let rank = "";
    let medal = 1;
    if (accuracy >= 98 && bad == 0 && miss == 0 && bullet == 0) {
      rank = "SS";
    } else if (accuracy >= 95) {
      rank = "S";
    } else if (accuracy >= 90) {
      rank = "A";
    } else if (accuracy >= 80) {
      rank = "B";
    } else if (accuracy >= 70) {
      rank = "C";
    } else {
      rank = "F";
      medal = 0;
    }
    if (miss == 0 && bullet == 0) {
      if (medal == 0) {
        medal = 2;
      } else {
        medal = 3;
      }
      if (bad == 0 && good == 0 && great < 10 && perfect != 0) {
        medal = 7;
      }
    }
    io.to(socket.id).emit("game result", perfect, great, good, bad, miss, bullet, score, accuracy, rank);
    if (id) {
      fetch(`${config.project.api}/CPLrecord`, {
        method: "PUT",
        body: JSON.stringify({
          secret: config.project.secretKey,
          id: id,
          name: name,
          nickname: user,
          rank: rank,
          record: score,
          maxcombo: maxCombo,
          medal: medal,
          difficulty: difficulty + 1,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }).catch((error) => {
        console.log("error", error);
      });
    } else {
      fetch(`${config.project.api}/record`, {
        method: "PUT",
        body: JSON.stringify({
          secret: config.project.secretKey,
          name: name,
          nickname: user,
          rank: rank,
          record: score,
          maxcombo: maxCombo,
          medal: medal,
          difficulty: difficulty + 1,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }).catch((error) => {
        console.log("error", error);
      });
    }
  });

  socket.on("disconnect", () => {
    signale.debug(`${socket.id} : User Disconnected.`);
    redisClient.del(`perfect${socket.id}`);
    redisClient.del(`great${socket.id}`);
    redisClient.del(`good${socket.id}`);
    redisClient.del(`bad${socket.id}`);
    redisClient.del(`miss${socket.id}`);
    redisClient.del(`bullet${socket.id}`);
    redisClient.del(`score${socket.id}`);
    redisClient.del(`combo${socket.id}`);
    redisClient.del(`pattern${socket.id}`);
    redisClient.del(`destroyedNotes${socket.id}`);
    redisClient.del(`destroyedBullets${socket.id}`);
    redisClient.del(`ms${socket.id}`);
    redisClient.del(`pauseDate${socket.id}`);
    redisClient.del(`socket${socket.id}`);
  });
});
