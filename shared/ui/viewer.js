/* ClassControl — зритель эфира в классе, который сам передаёт видео соседям.
   Учитель отправляет поток только нескольким компьютерам, а те — дальше по цепочке:
   так ноутбук учителя не кодирует видео 30 раз. */
(function () {
  'use strict';

  CC.ClassViewer = function ({ socket, onStream, onState }) {
    let parent = null;             // { id, peer }
    let stream = null;
    let videoPolicy = {};
    socket.on('broadcast-started',state=>{videoPolicy=state?.video||{};});
    const children = new Map();    // childId -> peer | 'pending'

    async function offerChild(id) {
      if (!stream) { children.set(id, 'pending'); return; }
      const old = children.get(id);
      if (old && old !== 'pending') old.close();
      try {
        const peer = await CC.offerPeer({
          socket, target: id, kind: 'broadcast', stream,
          onPeer: p => children.set(id, p),
          onState: (st) => { if (st === 'failed') { socket.emit('relay-failed', { id }); dropChild(id); } }
        });
        const video = stream.getVideoTracks()[0];
        const media = video ? video.getSettings() : {};
        CC.limitBitrate(peer.pc, CC.videoBudget({ ...media, ...videoPolicy, fps: videoPolicy.fps || media.frameRate || 30, viewers: Math.max(1, children.size) }));
        children.set(id, peer);
      } catch (e) {
        socket.emit('relay-failed', { id });
      }
    }

    function dropChild(id) {
      const p = children.get(id);
      if (p && p !== 'pending') p.close();
      children.delete(id);
    }

    async function setStream(s) {
      const changed = stream !== s;
      stream = s;
      if (!changed) return;
      socket.emit('relay-ready');
      // Новый поток от родителя — подменяем дорожки у всех, кого мы кормим
      for (const [id, p] of children) {
        if (p === 'pending') { offerChild(id); continue; }
        for (const sender of p.pc.getSenders()) {
          const track = s.getTracks().find(t => sender.track && t.kind === sender.track.kind);
          if (track) await sender.replaceTrack(track).catch(() => {});
        }
      }
    }

    socket.on('relay-child', ({ id }) => offerChild(id));
    socket.on('relay-child-gone', ({ id }) => dropChild(id));

    socket.on('signal', async ({ source, kind, type, payload }) => {
      if (kind !== 'broadcast') return;
      try {
        if (children.has(source)) {
          const p = children.get(source);
          if (p === 'pending') return;
          if (type === 'answer') await p.answer(payload);
          else if (type === 'ice') await p.ice(payload);
          return;
        }
        if (type === 'offer') {
          if (parent) parent.peer.close();
          parent = {
            id: source,
            peer: CC.answerPeer({
              socket, source, kind: 'broadcast',
              onTrack: (s) => { onStream && onStream(s); setStream(s); },
              onState: (st) => onState && onState(st)
            })
          };
          await parent.peer.offer(payload);
        } else if (type === 'ice' && parent && parent.id === source) {
          await parent.peer.ice(payload);
        }
      } catch (e) {
        console.error('[VIEWER]', e);
      }
    });

    return {
      stop() {
        if (parent) parent.peer.close();
        parent = null;
        stream = null;
        for (const id of [...children.keys()]) dropChild(id);
      },
      get childCount() { return children.size; }
    };
  };
})();
