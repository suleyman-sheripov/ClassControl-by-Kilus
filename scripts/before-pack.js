'use strict';
module.exports = async (context) => {
  if (context.packager.appInfo.id !== 'com.classcontrol.teacher') return;
  const arch = require('../teacher/node_modules/builder-util').Arch[
    context.arch
  ];
  require('./vendor-cloudflared').vendor(context.electronPlatformName, arch);
};
