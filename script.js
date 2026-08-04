(function(){
  'use strict';

  var STORAGE_KEY = 'lecture_register_data_v1';
  var app = document.getElementById('app');
  var importInput = document.getElementById('importFileInput');

  var data = null;      // root folder node
  var path = ['root'];  // array of folder ids, root -> ... -> current
  var searchQuery = '';

  // ---------- storage ----------
  function defaultData(){
    return { id:'root', type:'folder', name:'My Library', children:[] };
  }
  function loadData(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultData();
      var parsed = JSON.parse(raw);
      if(!parsed || parsed.type !== 'folder') return defaultData();
      return parsed;
    }catch(e){ return defaultData(); }
  }
  function saveData(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){}
  }

  // ---------- id / tree helpers ----------
  function genId(){ return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

  function findNode(id, node){
    node = node || data;
    if(node.id === id) return node;
    if(node.type === 'folder' && node.children){
      for(var i=0;i<node.children.length;i++){
        var found = findNode(id, node.children[i]);
        if(found) return found;
      }
    }
    return null;
  }
  function findParent(id, node){
    node = node || data;
    if(node.type === 'folder' && node.children){
      for(var i=0;i<node.children.length;i++){
        if(node.children[i].id === id) return node;
        var found = findParent(id, node.children[i]);
        if(found) return found;
      }
    }
    return null;
  }
  function progressOf(node){
    var total = 0, watched = 0;
    (function walk(n){
      if(n.type === 'link'){ total++; if(n.watched) watched++; return; }
      if(n.children) n.children.forEach(walk);
    })(node);
    return { total: total, watched: watched };
  }
  function nodePath(id){
    // returns array of node objects from root to id (inclusive), or null
    var result = [];
    function walk(node, trail){
      var newTrail = trail.concat([node]);
      if(node.id === id){ result = newTrail; return true; }
      if(node.type === 'folder' && node.children){
        for(var i=0;i<node.children.length;i++){
          if(walk(node.children[i], newTrail)) return true;
        }
      }
      return false;
    }
    walk(data, []);
    return result.length ? result : null;
  }
  function isDescendantOf(ancestorId, nodeId){
    var anc = findNode(ancestorId);
    if(!anc) return false;
    var found = false;
    (function walk(n){
      if(n.id === nodeId){ found = true; return; }
      if(n.type === 'folder' && n.children) n.children.forEach(walk);
    })(anc);
    return found;
  }

  function currentFolder(){
    return findNode(path[path.length-1]) || data;
  }

  // ---------- utils ----------
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function isYoutube(url){
    return /youtube\.com|youtu\.be/i.test(url || '');
  }
  function safeUrl(url){
    try{
      var u = new URL(url);
      if(u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    }catch(e){}
    return null;
  }

  // ---------- rendering ----------
  function render(){
    var html = '';
    html += renderCover();
    html += renderToolbar();

    if(searchQuery.trim()){
      html += renderSearchResults();
    } else {
      html += renderTrail();
      html += renderLedgerPage();
    }

    html += '<footer class="credits">Filed locally in this browser &middot; export a backup anytime</footer>';
    app.innerHTML = html;
    wireEvents();
  }

  function renderCover(){
    return (
      '<div class="cover">' +
        '<span class="stamp">Vol. I &middot; Study Archive</span>' +
        '<h1>Lecture Register</h1>' +
        '<p>YouTube lectures, filed subject by subject, chapter by chapter</p>' +
      '</div>'
    );
  }

  function renderToolbar(){
    return (
      '<div class="toolbar">' +
        '<div class="search-wrap">' +
          '<span class="icon">&#128269;</span>' +
          '<input type="text" id="searchInput" placeholder="Search every folder and link..." value="' + esc(searchQuery) + '">' +
        '</div>' +
        '<button class="btn ghost" id="exportBtn">&#11015; Export backup</button>' +
        '<button class="btn ghost" id="importBtn">&#11014; Import backup</button>' +
      '</div>'
    );
  }

  function renderTrail(){
    var crumbs = nodePath(currentFolder().id) || [data];
    var html = '<div class="trail">';
    crumbs.forEach(function(node, i){
      var isCurrent = i === crumbs.length - 1;
      html += '<button class="trail-tab' + (isCurrent ? ' current' : '') + '" data-nav="' + esc(node.id) + '"' + (isCurrent ? ' disabled' : '') + '>' +
        esc(node.name) + '</button>';
    });
    html += '</div>';
    return html;
  }

  function renderLedgerPage(){
    var folder = currentFolder();
    var kids = folder.children || [];
    var subfolders = kids.filter(function(k){ return k.type === 'folder'; });
    var links = kids.filter(function(k){ return k.type === 'link'; });

    var html = '<div class="ledger-page">';
    html += '<div class="page-actions">' +
      '<button class="btn" id="newFolderBtn">&#128193; New folder</button>' +
      '<button class="btn gold" id="newLinkBtn">&#9654; Add lecture link</button>' +
    '</div>';

    if(subfolders.length === 0 && links.length === 0){
      html += '<div class="empty-state">' +
        '<div class="big">This folder is empty</div>' +
        '<p>Create a subject or chapter folder, or file a lecture link here directly.</p>' +
      '</div>';
    } else {
      if(subfolders.length){
        html += '<div class="section-label">Folders</div>';
        html += '<div class="folder-grid">';
        subfolders.forEach(function(f){
          var prog = progressOf(f);
          var pct = prog.total ? Math.round((prog.watched/prog.total)*100) : 0;
          html += '<div class="folder-card" data-open="' + esc(f.id) + '">' +
            '<div class="card-menu">' +
              '<button class="icon-btn" data-rename="' + esc(f.id) + '" title="Rename">&#9998;</button>' +
              '<button class="icon-btn" data-move="' + esc(f.id) + '" title="Move">&#8693;</button>' +
              '<button class="icon-btn danger" data-delete-folder="' + esc(f.id) + '" title="Delete">&#10005;</button>' +
            '</div>' +
            '<span class="fname">' + esc(f.name) + '</span>' +
            '<div class="fmeta">' +
              (prog.total ? ('<div class="prog-bar"><div class="prog-fill" style="width:' + pct + '%;"></div></div><span>' + prog.watched + '/' + prog.total + '</span>')
                : '<span>empty</span>') +
            '</div>' +
          '</div>';
        });
        html += '</div>';
      }
      if(links.length){
        html += '<div class="section-label">Lecture links</div>';
        html += '<div class="link-rows">';
        links.forEach(function(l, i){
          html += renderLinkRow(l, i+1);
        });
        html += '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  function renderLinkRow(l, rollNum, pathHint){
    var url = safeUrl(l.url) || '#';
    return (
      '<div class="link-row' + (l.watched ? ' watched' : '') + '">' +
        '<span class="roll">' + (rollNum != null ? String(rollNum).padStart(2,'0') : '') + '</span>' +
        '<button class="watch-box" data-toggle-watch="' + esc(l.id) + '" title="Mark watched">' + (l.watched ? '&#10003;' : '') + '</button>' +
        '<div class="link-body">' +
          '<a class="ltitle" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(l.name) + '</a>' +
          '<div class="lmeta">' +
            (isYoutube(l.url) ? '<span class="tag">YouTube</span>' : '') +
            (pathHint ? '<span class="path-hint">' + esc(pathHint) + '</span>' : '') +
            (l.note ? '<span class="note">' + esc(l.note) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="row-actions">' +
          '<button class="icon-btn" data-rename-link="' + esc(l.id) + '" title="Edit">&#9998;</button>' +
          '<button class="icon-btn" data-move="' + esc(l.id) + '" title="Move">&#8693;</button>' +
          '<button class="icon-btn danger" data-delete-link="' + esc(l.id) + '" title="Delete">&#10005;</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderSearchResults(){
    var q = searchQuery.trim().toLowerCase();
    var matches = [];
    (function walk(node, trail){
      var newTrail = trail.concat([node.name]);
      if(node.id !== 'root'){
        var hay = (node.name + ' ' + (node.note || '')).toLowerCase();
        if(hay.indexOf(q) !== -1) matches.push({ node: node, trail: trail });
      }
      if(node.type === 'folder' && node.children) node.children.forEach(function(c){ walk(c, newTrail); });
    })(data, []);

    var html = '<div class="ledger-page search-results">';
    html += '<div class="section-label">' + matches.length + ' result' + (matches.length === 1 ? '' : 's') + ' for &ldquo;' + esc(searchQuery.trim()) + '&rdquo;</div>';
    if(matches.length === 0){
      html += '<div class="empty-state"><div class="big">No matches</div><p>Try a shorter or different word.</p></div>';
    } else {
      html += '<div class="link-rows">';
      matches.forEach(function(m){
        var pathHint = m.trail.map(function(n){ return n.name; }).join(' / ') || 'My Library';
        if(m.node.type === 'link'){
          html += renderLinkRow(m.node, null, pathHint);
        } else {
          var prog = progressOf(m.node);
          html += '<div class="link-row" data-open="' + esc(m.node.id) + '" style="cursor:pointer;">' +
            '<span class="roll">&#128193;</span>' +
            '<div class="link-body">' +
              '<span class="ltitle">' + esc(m.node.name) + '</span>' +
              '<div class="lmeta"><span class="path-hint">' + esc(pathHint) + '</span>' +
                (prog.total ? ('<span>' + prog.watched + '/' + prog.total + ' watched</span>') : '') +
              '</div>' +
            '</div>' +
          '</div>';
        }
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ---------- modal ----------
  function openModal(innerHtml){
    closeModal();
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.id = 'modalBackdrop';
    backdrop.innerHTML = '<div class="modal-card">' +
      '<button class="modal-close" id="modalCloseBtn" title="Close">&#10005;</button>' + innerHtml +
    '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function(e){ if(e.target === backdrop) closeModal(); });
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  }
  function closeModal(){
    var existing = document.getElementById('modalBackdrop');
    if(existing) existing.remove();
  }

  function promptFolderModal(existingFolder){
    var isEdit = !!existingFolder;
    openModal(
      '<h3>' + (isEdit ? 'Rename folder' : 'New folder') + '</h3>' +
      '<label class="field-label">Folder name</label>' +
      '<input type="text" id="folderNameInput" placeholder="e.g. Business Economics" value="' + esc(isEdit ? existingFolder.name : '') + '">' +
      '<div class="modal-actions">' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '<button class="btn gold" id="modalSaveBtn">' + (isEdit ? 'Save' : 'Create') + '</button>' +
      '</div>'
    );
    var input = document.getElementById('folderNameInput');
    input.focus();
    input.select();
    function submit(){
      var name = input.value.trim();
      if(!name) return;
      if(isEdit){
        existingFolder.name = name;
      } else {
        currentFolder().children = currentFolder().children || [];
        currentFolder().children.push({ id: genId(), type:'folder', name: name, children: [] });
      }
      saveData(); closeModal(); render();
    }
    document.getElementById('modalSaveBtn').addEventListener('click', submit);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    input.addEventListener('keydown', function(e){ if(e.key === 'Enter') submit(); });
  }

  function promptLinkModal(existingLink){
    var isEdit = !!existingLink;
    openModal(
      '<h3>' + (isEdit ? 'Edit lecture link' : 'Add lecture link') + '</h3>' +
      '<label class="field-label">Title</label>' +
      '<input type="text" id="linkNameInput" placeholder="e.g. Ch.1 Nature and Scope - Part 1" value="' + esc(isEdit ? existingLink.name : '') + '">' +
      '<label class="field-label">YouTube / video URL</label>' +
      '<input type="url" id="linkUrlInput" placeholder="https://youtube.com/watch?v=..." value="' + esc(isEdit ? existingLink.url : '') + '">' +
      '<label class="field-label">Note (optional)</label>' +
      '<textarea id="linkNoteInput" placeholder="Teacher, timestamp, anything to remember...">' + esc(isEdit ? (existingLink.note || '') : '') + '</textarea>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '<button class="btn gold" id="modalSaveBtn">' + (isEdit ? 'Save' : 'Add link') + '</button>' +
      '</div>'
    );
    var nameInput = document.getElementById('linkNameInput');
    nameInput.focus();
    function submit(){
      var name = nameInput.value.trim();
      var url = document.getElementById('linkUrlInput').value.trim();
      var note = document.getElementById('linkNoteInput').value.trim();
      if(!name || !url) { alert('Title aur URL dono chahiye.'); return; }
      if(!safeUrl(url)){ alert('Ye ek valid http/https link nahi lag raha. Check karo.'); return; }
      if(isEdit){
        existingLink.name = name; existingLink.url = url; existingLink.note = note;
      } else {
        currentFolder().children = currentFolder().children || [];
        currentFolder().children.push({ id: genId(), type:'link', name: name, url: url, note: note, watched:false });
      }
      saveData(); closeModal(); render();
    }
    document.getElementById('modalSaveBtn').addEventListener('click', submit);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  }

  function promptMoveModal(nodeId){
    var node = findNode(nodeId);
    if(!node) return;
    var options = [];
    (function walk(n, depth){
      if(n.type !== 'folder') return;
      var blocked = (n.id === node.id) || (node.type === 'folder' && isDescendantOf(node.id, n.id));
      options.push({ id:n.id, label: (depth>0? '\u00A0\u00A0'.repeat(depth) + '\u21B3 ':'') + n.name, blocked: blocked });
      (n.children||[]).forEach(function(c){ if(c.type==='folder') walk(c, depth+1); });
    })(data, 0);

    var currentParent = findParent(node.id);
    var html = '<h3>Move &ldquo;' + esc(node.name) + '&rdquo;</h3>' +
      '<label class="field-label">Choose destination folder</label>' +
      '<div class="picker-list">' +
      options.map(function(o){
        return '<div class="picker-item' + (o.blocked ? '' : '') + '" data-pick="' + esc(o.id) + '"' +
          (o.blocked ? ' style="opacity:.35;pointer-events:none;"' : '') + '>' + o.label + '</div>';
      }).join('') +
      '</div>' +
      '<div class="modal-actions"><button class="btn" id="modalCancelBtn">Cancel</button></div>';
    openModal(html);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    document.querySelectorAll('.picker-item[data-pick]').forEach(function(item){
      item.addEventListener('click', function(){
        var destId = item.getAttribute('data-pick');
        var dest = findNode(destId);
        if(!dest) return;
        var parent = currentParent || data;
        parent.children = (parent.children||[]).filter(function(c){ return c.id !== node.id; });
        dest.children = dest.children || [];
        dest.children.push(node);
        saveData(); closeModal(); render();
      });
    });
  }

  // ---------- import / export ----------
  function exportBackup(){
    var blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = 'lecture-register-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }
  function importBackup(file){
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!parsed || parsed.type !== 'folder'){ throw new Error('bad shape'); }
        var ok = confirm('Ye import current library ko PURI TARAH REPLACE kar dega. Pehle export karke backup le liya? Continue karein?');
        if(!ok) return;
        data = parsed;
        path = ['root'];
        saveData();
        render();
        alert('Backup import ho gaya.');
      }catch(e){
        alert('Ye file valid Lecture Register backup nahi lag rahi.');
      }
    };
    reader.readAsText(file);
  }

  // ---------- delete ----------
  function deleteFolder(id){
    var node = findNode(id);
    if(!node) return;
    var prog = progressOf(node);
    var subCount = 0;
    (function walk(n){ (n.children||[]).forEach(function(c){ if(c.type==='folder'){ subCount++; walk(c); } }); })(node);
    var msg = 'Delete folder "' + node.name + '"?';
    if(prog.total || subCount) msg += ' Isme ' + subCount + ' sub-folder(s) aur ' + prog.total + ' link(s) bhi hai — sab delete ho jayenge.';
    if(!confirm(msg)) return;
    var parent = findParent(id);
    if(!parent) return;
    parent.children = parent.children.filter(function(c){ return c.id !== id; });
    if(path.indexOf(id) !== -1){
      path = path.slice(0, path.indexOf(id));
      if(path.length === 0) path = ['root'];
    }
    saveData(); render();
  }
  function deleteLink(id){
    var node = findNode(id);
    if(!node) return;
    if(!confirm('Delete link "' + node.name + '"?')) return;
    var parent = findParent(id);
    if(!parent) return;
    parent.children = parent.children.filter(function(c){ return c.id !== id; });
    saveData(); render();
  }

  // ---------- events ----------
  function wireEvents(){
    var searchInput = document.getElementById('searchInput');
    if(searchInput){
      searchInput.addEventListener('input', function(){
        searchQuery = searchInput.value;
        render();
        var el = document.getElementById('searchInput');
        if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }
    var exportBtn = document.getElementById('exportBtn');
    if(exportBtn) exportBtn.addEventListener('click', exportBackup);
    var importBtn = document.getElementById('importBtn');
    if(importBtn) importBtn.addEventListener('click', function(){ importInput.click(); });

    var newFolderBtn = document.getElementById('newFolderBtn');
    if(newFolderBtn) newFolderBtn.addEventListener('click', function(){ promptFolderModal(null); });
    var newLinkBtn = document.getElementById('newLinkBtn');
    if(newLinkBtn) newLinkBtn.addEventListener('click', function(){ promptLinkModal(null); });

    document.querySelectorAll('[data-nav]').forEach(function(el){
      el.addEventListener('click', function(){
        var id = el.getAttribute('data-nav');
        var idx = path.indexOf(id);
        if(idx !== -1) path = path.slice(0, idx+1);
        render();
      });
    });
    document.querySelectorAll('[data-open]').forEach(function(el){
      el.addEventListener('click', function(e){
        if(e.target.closest('.card-menu') || e.target.closest('.icon-btn')) return;
        var id = el.getAttribute('data-open');
        searchQuery = '';
        var trail = nodePath(id);
        if(trail) path = trail.map(function(n){ return n.id; });
        render();
      });
    });
    document.querySelectorAll('[data-rename]').forEach(function(el){
      el.addEventListener('click', function(e){
        e.stopPropagation();
        var node = findNode(el.getAttribute('data-rename'));
        if(node) promptFolderModal(node);
      });
    });
    document.querySelectorAll('[data-rename-link]').forEach(function(el){
      el.addEventListener('click', function(e){
        e.stopPropagation();
        var node = findNode(el.getAttribute('data-rename-link'));
        if(node) promptLinkModal(node);
      });
    });
    document.querySelectorAll('[data-delete-folder]').forEach(function(el){
      el.addEventListener('click', function(e){ e.stopPropagation(); deleteFolder(el.getAttribute('data-delete-folder')); });
    });
    document.querySelectorAll('[data-delete-link]').forEach(function(el){
      el.addEventListener('click', function(e){ e.stopPropagation(); deleteLink(el.getAttribute('data-delete-link')); });
    });
    document.querySelectorAll('[data-move]').forEach(function(el){
      el.addEventListener('click', function(e){ e.stopPropagation(); promptMoveModal(el.getAttribute('data-move')); });
    });
    document.querySelectorAll('[data-toggle-watch]').forEach(function(el){
      el.addEventListener('click', function(e){
        e.stopPropagation();
        var node = findNode(el.getAttribute('data-toggle-watch'));
        if(node){ node.watched = !node.watched; saveData(); render(); }
      });
    });
  }

  importInput.addEventListener('change', function(){
    if(importInput.files && importInput.files[0]) importBackup(importInput.files[0]);
    importInput.value = '';
  });

  // ---------- init ----------
  data = loadData();
  render();
})();
