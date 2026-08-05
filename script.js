(function(){
  'use strict';

  var STORAGE_KEY = 'studystack_data_v1';
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

  // ---------- OMDb (IMDb) key — stored only in this browser, never in source files ----------
  var STORAGE_OMDB_KEY = 'studystack_omdb_key';
  function getOmdbKey(){ try{ return localStorage.getItem(STORAGE_OMDB_KEY) || ''; }catch(e){ return ''; } }
  function setOmdbKey(key){
    try{
      if(key) localStorage.setItem(STORAGE_OMDB_KEY, key);
      else localStorage.removeItem(STORAGE_OMDB_KEY);
    }catch(e){}
  }
  function promptOmdbKey(){
    var existing = getOmdbKey();
    var masked = existing ? (existing.slice(0,4) + '••••' + existing.slice(-2)) : null;
    var message = masked
      ? 'OMDb (IMDb) API key set hai (' + masked + ').\n\nNaya key paste karo replace karne ke liye, ya CLEAR likho hatane ke liye:'
      : 'Apna OMDb API key paste karo (omdbapi.com se free milta hai).\n\nYe sirf is browser mein save hota hai — kabhi source files mein nahi jaata.';
    var input = prompt(message, '');
    if(input === null) return;
    var trimmed = input.trim();
    if(trimmed.toUpperCase() === 'CLEAR'){ setOmdbKey(null); alert('OMDb key hata di gayi.'); }
    else if(trimmed){ setOmdbKey(trimmed); alert('OMDb key save ho gayi. Ab "Add link" mein Title ke paas Auto-fill button use kar sakte ho.'); }
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
  var SITE_LABELS = {
    'youtube.com':'YouTube', 'youtu.be':'YouTube',
    'netflix.com':'Netflix', 'primevideo.com':'Prime Video', 'amazon.com':'Amazon',
    'hotstar.com':'Hotstar', 'jiocinema.com':'JioCinema', 'sonyliv.com':'SonyLIV',
    'instagram.com':'Instagram', 'twitter.com':'Twitter', 'x.com':'X',
    'spotify.com':'Spotify', 'github.com':'GitHub', 'medium.com':'Medium',
    'wikipedia.org':'Wikipedia', 'drive.google.com':'Drive', 'docs.google.com':'Docs'
  };
  function hostnameOf(url){
    try{ return new URL(url).hostname.replace(/^www\./,''); }catch(e){ return ''; }
  }
  function siteLabel(url){
    var host = hostnameOf(url);
    if(!host) return '';
    if(SITE_LABELS[host]) return SITE_LABELS[host];
    var parts = host.split('.');
    return parts.length >= 2 ? host : host;
  }
  function faviconUrl(url){
    var host = hostnameOf(url);
    if(!host) return '';
    return 'https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(host);
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

  function renderToolbar(){
    return (
      '<div class="toolbar">' +
        '<div class="brand-tag">&#128193; StudyStack</div>' +
        '<div class="search-wrap">' +
          '<span class="icon">&#128269;</span>' +
          '<input type="text" id="searchInput" placeholder="Search every folder and link..." value="' + esc(searchQuery) + '">' +
        '</div>' +
        '<button class="btn ghost" id="omdbKeyBtn">&#127916; OMDb Key</button>' +
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
      (path.length > 1 ? '<button class="btn ghost" id="exportFolderBtn">&#11015; Export this folder</button>' : '') +
      '<button class="btn" id="newFolderBtn">&#128193; New folder</button>' +
      '<button class="btn gold" id="newLinkBtn">&#9654; Add link</button>' +
    '</div>';

    if(subfolders.length === 0 && links.length === 0){
      html += '<div class="empty-state">' +
        '<div class="big">This folder is empty</div>' +
        '<p>Create a folder, or save a link here directly — movies, courses, anime, articles, anything.</p>' +
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
        html += '<div class="section-label">Links</div>';
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
    var fav = faviconUrl(url);
    var site = siteLabel(url);
    return (
      '<div class="link-row' + (l.watched ? ' watched' : '') + '">' +
        '<span class="roll">' + (rollNum != null ? String(rollNum).padStart(2,'0') : '') + '</span>' +
        '<button class="watch-box" data-toggle-watch="' + esc(l.id) + '" title="Mark as done">' + (l.watched ? '&#10003;' : '') + '</button>' +
        '<div class="link-body">' +
          '<a class="ltitle" href="' + esc(url) + '" target="_blank" rel="noopener">' +
            (fav ? '<img class="favicon" src="' + esc(fav) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
            esc(l.name) +
          '</a>' +
          '<div class="lmeta">' +
            (site ? '<span class="tag">' + esc(site) + '</span>' : '') +
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
      '<input type="text" id="folderNameInput" placeholder="e.g. Movies, Anime, Business Economics" value="' + esc(isEdit ? existingFolder.name : '') + '">' +
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
    var folder = currentFolder();
    var initialNote = isEdit ? (existingLink.note || '') : (folder.noteTemplate || '');
    openModal(
      '<h3>' + (isEdit ? 'Edit link' : 'Add link') + '</h3>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<label class="field-label" style="margin:0;">Title</label>' +
        '<button type="button" class="icon-btn" id="omdbFillBtn" style="font-size:.66rem;color:var(--gold);white-space:nowrap;" title="Fetch movie/show info from IMDb">&#127916; Auto-fill from IMDb</button>' +
      '</div>' +
      '<input type="text" id="linkNameInput" placeholder="e.g. The Station Agent (2003), or Ch.2 - ICA 1872" value="' + esc(isEdit ? existingLink.name : '') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<label class="field-label" style="margin:0;">Link (any website)</label>' +
        '<button type="button" class="icon-btn" id="ytFillBtn" style="font-size:.66rem;color:var(--gold);white-space:nowrap;" title="Fetch title from YouTube">&#9654; Fetch YouTube title</button>' +
      '</div>' +
      '<input type="url" id="linkUrlInput" placeholder="https:// ... YouTube, Netflix, an article, anything" value="' + esc(isEdit ? existingLink.url : '') + '">' +
      '<label class="field-label">Note (optional)</label>' +
      '<textarea id="linkNoteInput" placeholder="Cast, teacher, timestamp, anything to remember...">' + esc(initialNote) + '</textarea>' +
      (!isEdit && folder.noteTemplate ? '<div style="font-size:.68rem;color:var(--ink-soft);margin-top:4px;">Pre-filled from this folder\u2019s last note — edit or clear as needed.</div>' : '') +
      '<div class="modal-actions">' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '<button class="btn gold" id="modalSaveBtn">' + (isEdit ? 'Save' : 'Add link') + '</button>' +
      '</div>'
    );
    var nameInput = document.getElementById('linkNameInput');
    nameInput.focus();

    document.getElementById('omdbFillBtn').addEventListener('click', runOmdbAutofill);
    document.getElementById('ytFillBtn').addEventListener('click', runYoutubeAutofill);

    function runOmdbAutofill(){
      var key = getOmdbKey();
      if(!key){
        if(confirm('OMDb API key set nahi hai. Abhi set karna chahoge?')) promptOmdbKey();
        return;
      }
      var titleVal = nameInput.value.trim();
      if(!titleVal){ alert('Pehle Title field mein movie/show ka naam likho.'); return; }
      var btn = document.getElementById('omdbFillBtn');
      var original = btn.innerHTML;
      btn.innerHTML = '⏳'; btn.disabled = true;
      fetch('https://www.omdbapi.com/?apikey=' + encodeURIComponent(key) + '&t=' + encodeURIComponent(titleVal))
        .then(function(r){ return r.json(); })
        .then(function(d){
          if(d.Response === 'False'){ alert('IMDb par "' + titleVal + '" nahi mila: ' + (d.Error || '')); return; }
          var parts = [];
          if(d.Year) parts.push('Year: ' + d.Year);
          if(d.Genre && d.Genre !== 'N/A') parts.push('Genre: ' + d.Genre);
          if(d.Actors && d.Actors !== 'N/A') parts.push('Cast: ' + d.Actors);
          if(d.Director && d.Director !== 'N/A') parts.push('Director: ' + d.Director);
          if(d.Plot && d.Plot !== 'N/A') parts.push('Plot: ' + d.Plot);
          document.getElementById('linkNoteInput').value = parts.join('\n');
          if(d.Title) nameInput.value = d.Title + (d.Year ? ' (' + d.Year + ')' : '');
        })
        .catch(function(){ alert('IMDb se data nahi mil paaya. Internet ya API key check karo.'); })
        .then(function(){ btn.innerHTML = original; btn.disabled = false; }, function(){ btn.innerHTML = original; btn.disabled = false; });
    }

    function runYoutubeAutofill(){
      var urlVal = document.getElementById('linkUrlInput').value.trim();
      if(!urlVal){ alert('Pehle Link field mein YouTube URL paste karo.'); return; }
      if(!/youtube\.com|youtu\.be/i.test(urlVal)){ alert('Ye YouTube link nahi lag raha — ye button sirf YouTube ke liye kaam karta hai.'); return; }
      var btn = document.getElementById('ytFillBtn');
      var original = btn.innerHTML;
      btn.innerHTML = '⏳'; btn.disabled = true;
      fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(urlVal) + '&format=json')
        .then(function(r){ if(!r.ok) throw new Error('not found'); return r.json(); })
        .then(function(d){
          nameInput.value = d.title || nameInput.value;
          var noteEl = document.getElementById('linkNoteInput');
          if(!noteEl.value.trim() && d.author_name) noteEl.value = 'Channel: ' + d.author_name;
        })
        .catch(function(){ alert('Video ka title nahi mil paaya — link private ya galat ho sakta hai.'); })
        .then(function(){ btn.innerHTML = original; btn.disabled = false; }, function(){ btn.innerHTML = original; btn.disabled = false; });
    }

    function submit(){
      var name = nameInput.value.trim();
      var url = document.getElementById('linkUrlInput').value.trim();
      var note = document.getElementById('linkNoteInput').value.trim();
      if(!name || !url) { alert('Title aur URL dono chahiye.'); return; }
      if(!safeUrl(url)){ alert('Ye ek valid http/https link nahi lag raha. Check karo.'); return; }
      if(isEdit){
        existingLink.name = name; existingLink.url = url; existingLink.note = note;
      } else {
        folder.children = folder.children || [];
        folder.children.push({ id: genId(), type:'link', name: name, url: url, note: note, watched:false });
        if(note) folder.noteTemplate = note;
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
  function slugify(name){
    return (name || 'export').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'export';
  }
  function exportNode(node, filePrefix){
    var blob = new Blob([JSON.stringify(node, null, 2)], { type:'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = filePrefix + '-' + slugify(node.name) + '-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }
  function exportBackup(){ exportNode(data, 'studystack-full'); }
  function exportCurrentFolder(){ exportNode(currentFolder(), 'studystack-folder'); }

  function regenerateIds(node){
    var clone = JSON.parse(JSON.stringify(node));
    (function walk(n){
      n.id = genId();
      if(n.type === 'folder' && n.children) n.children.forEach(walk);
    })(clone);
    return clone;
  }

  function importBackup(file){
    var reader = new FileReader();
    reader.onload = function(){
      var parsed;
      try{ parsed = JSON.parse(reader.result); }catch(e){ alert('Ye JSON file valid nahi hai.'); return; }
      if(!parsed || parsed.type !== 'folder' || typeof parsed.name !== 'string'){
        alert('Ye StudyStack backup file nahi lag rahi.');
        return;
      }
      promptImportChoiceModal(parsed);
    };
    reader.readAsText(file);
  }

  function promptImportChoiceModal(parsed){
    var prog = progressOf(parsed);
    openModal(
      '<h3>Import &ldquo;' + esc(parsed.name) + '&rdquo;</h3>' +
      '<p style="font-size:.8rem;color:var(--ink-soft);margin:0 0 18px;">' +
        'Contains ' + prog.total + ' link(s). Kaise import karna hai?' +
      '</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<button class="btn gold" id="mergeBtn" style="text-align:left;">Add into current folder<br><span style="font-weight:400;font-size:.72rem;opacity:.75;">Keeps everything you already have — just adds this as a new folder here.</span></button>' +
        '<button class="btn danger" id="replaceBtn" style="text-align:left;">Replace entire library<br><span style="font-weight:400;font-size:.72rem;opacity:.75;">Overwrites everything currently saved in this browser.</span></button>' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
      '</div>'
    );
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    document.getElementById('mergeBtn').addEventListener('click', function(){
      var clone = regenerateIds(parsed);
      currentFolder().children = currentFolder().children || [];
      currentFolder().children.push(clone);
      saveData(); closeModal(); render();
    });
    document.getElementById('replaceBtn').addEventListener('click', function(){
      if(!confirm('Pakka? Ye current PURI library replace kar dega — is action ko undo nahi kar sakte (jab tak apni purani backup file na ho).')) return;
      var clone = regenerateIds(parsed);
      clone.id = 'root';
      data = clone;
      path = ['root'];
      saveData(); closeModal(); render();
    });
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
    var omdbKeyBtn = document.getElementById('omdbKeyBtn');
    if(omdbKeyBtn) omdbKeyBtn.addEventListener('click', promptOmdbKey);
    var exportBtn = document.getElementById('exportBtn');
    if(exportBtn) exportBtn.addEventListener('click', exportBackup);
    var exportFolderBtn = document.getElementById('exportFolderBtn');
    if(exportFolderBtn) exportFolderBtn.addEventListener('click', exportCurrentFolder);
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
