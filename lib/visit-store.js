const fs = require("fs");

function createVisitStore(visitsFile) {
  const dataDir = require("path").dirname(visitsFile);

  function ensureDataFile() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(visitsFile)) fs.writeFileSync(visitsFile, "[]\n");
  }

  function readVisits() {
    ensureDataFile();
    try {
      return JSON.parse(fs.readFileSync(visitsFile, "utf8"));
    } catch {
      return [];
    }
  }

  function writeVisits(visits) {
    ensureDataFile();
    fs.writeFileSync(visitsFile, JSON.stringify(visits, null, 2) + "\n");
  }

  function addVisit(record) {
    const visits = readVisits();
    visits.push(record);
    writeVisits(visits);
  }

  function clearVisits() {
    writeVisits([]);
  }

  return { readVisits, addVisit, clearVisits };
}

module.exports = { createVisitStore };
