const _a0 = require("crypto");
const { renderConsent: _a1 } = require("../views/consent");
const { getClientIp: _a2, lookupIp: _a3 } = require("../lib/ip-location");

const _b = [
  "GET",
  "POST",
  "/consent",
  "/collect",
  "source",
  "error",
  "city",
  "region",
  "country",
  "postal",
  "latitude",
  "longitude",
  "org",
  "note",
  "IP 위치 조회 실패: ",
  "id",
  "createdAt",
  "consent",
  "ip",
  "geo",
  "userAgent",
  "headers",
  "user-agent",
  "",
  "addVisit",
  "writeHead",
  "Location",
  "/result?id=",
  "end",
  "method",
  "pathname",
  "handle"
];

const _c = (_d) => _b[_d];

function createConsentRoutes(_e) {
  const _f = _e.send;
  const _10 = _e.visitStore;

  const _11 = async (_12, _13) => {
    const _14 = _a2(_12);
    let _15;

    try {
      _15 = await _a3(_14);
    } catch (_16) {
      _15 = {
        [_c(4)]: _c(5),
        [_c(6)]: _c(23),
        [_c(7)]: _c(23),
        [_c(8)]: _c(23),
        [_c(9)]: _c(23),
        [_c(10)]: _c(23),
        [_c(11)]: _c(23),
        [_c(12)]: _c(23),
        [_c(13)]: _c(14) + _16.message
      };
    }

    const _17 = {
      [_c(15)]: _a0.randomUUID(),
      [_c(16)]: new Date().toISOString(),
      [_c(17)]: true,
      [_c(18)]: _14,
      [_c(19)]: _15,
      [_c(20)]: _12[_c(21)][_c(22)] || _c(23)
    };

    _10[_c(24)](_17);
    _13[_c(25)](303, { [_c(26)]: _c(27) + encodeURIComponent(_17[_c(15)]) });
    _13[_c(28)]();
  };

  const _18 = async (_19, _1a, _1b) => {
    if (_19[_c(29)] === _c(0) && _1b[_c(30)] === _c(2)) {
      await _11(_19, _1a);
      return true;
    }

    if (_19[_c(29)] === _c(1) && _1b[_c(30)] === _c(3)) {
      await _11(_19, _1a);
      return true;
    }

    return false;
  };

  return { [_c(31)]: _18 };
}

module.exports = { createConsentRoutes };
