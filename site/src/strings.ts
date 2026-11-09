// Every visible sentence of the page, in English and German side by side.
// Values may contain inline HTML (strong, code, kbd, links); {{name}} slots are
// filled at build time from the benchmark reports and the built package (see
// build/figures.ts), formatted for each language. VERIFIED: (build) a missing,
// unused or forbidden string fails the build.
import type { Strings } from '../build/i18n.ts';

const t = (en: string, de: string) => ({ en, de });
const github = (path: string, label: string) =>
  `<a class="link" href="https://github.com/kyr0/defuss-storage/blob/main/${path}" target="_blank" rel="noopener">${label}</a>`;

export const strings: Strings = {
  // Header, menu, command palette
  'nav.skip': t('Skip to content', 'Zum Inhalt springen'),
  'nav.home': t('defuss-storage home', 'defuss-storage Startseite'),
  'nav.label': t('Main', 'Hauptnavigation'),
  'nav.demo': t('Demo', 'Demo'),
  'nav.how': t('How it works', 'So funktioniert es'),
  'nav.benchmarks': t('Benchmarks', 'Benchmarks'),
  'nav.install': t('Install', 'Installation'),
  'nav.demo2': t('Live demo', 'Live-Demo'),
  'nav.how2': t('How it works', 'So funktioniert es'),
  'nav.benchmarks2': t('Benchmarks', 'Benchmarks'),
  'nav.install2': t('Install', 'Installation'),
  'nav.jump': t('Jump to', 'Springen zu'),
  'nav.language': t('Language', 'Sprache'),
  'nav.dark': t('Dark mode', 'Dunkler Modus'),
  'nav.github': t('defuss-storage on GitHub (opens in a new tab)', 'defuss-storage auf GitHub (öffnet in neuem Tab)'),
  'nav.menu': t('Open menu', 'Menü öffnen'),
  'toast.label': t('Notifications', 'Benachrichtigungen'),
  'cmd.label': t('Jump to a section or change a setting', 'Zu einem Abschnitt springen oder eine Einstellung ändern'),
  'cmd.placeholder': t('Type to filter', 'Zum Filtern tippen'),
  'cmd.inputLabel': t('Filter commands', 'Befehle filtern'),
  'cmd.sections': t('Sections', 'Abschnitte'),
  'cmd.demo': t('Live demo', 'Live-Demo'),
  'cmd.playground': t('Playground: run your own code', 'Playground: eigenen Code ausführen'),
  'cmd.how': t('How it works', 'So funktioniert es'),
  'cmd.performance': t('Performance charts', 'Performance-Diagramme'),
  'cmd.install': t('Install and examples', 'Installation und Beispiele'),
  'cmd.api': t('API at a glance', 'API im Überblick'),
  'cmd.run': t('Run the benchmark in this browser', 'Benchmark in diesem Browser ausführen'),
  'cmd.settings': t('Settings', 'Einstellungen'),
  'cmd.theme': t('Switch light or dark theme', 'Hell oder dunkel umschalten'),
  'cmd.locale': t('Deutsch lesen', 'Read in English'),
  'cmd.empty': t('No match.', 'Kein Treffer.'),

  // Anchor labels
  'anchor.why': t('Link to section: What you get', 'Link zum Abschnitt: Was Sie bekommen'),
  'anchor.demo': t('Link to section: Live demo', 'Link zum Abschnitt: Live-Demo'),
  'anchor.persist': t('Link to demo: Persistence', 'Link zur Demo: Persistenz'),
  'anchor.ownership': t('Link to demo: Ownership', 'Link zur Demo: Besitz'),
  'anchor.backpressure': t('Link to demo: Backpressure', 'Link zur Demo: Gegendruck'),
  'anchor.playground': t('Link to demo: Playground', 'Link zur Demo: Playground'),
  'anchor.how': t('Link to section: How it works', 'Link zum Abschnitt: So funktioniert es'),
  'anchor.performance': t('Link to section: Performance', 'Link zum Abschnitt: Performance'),
  'anchor.quality': t('Link to section: Size and tests', 'Link zum Abschnitt: Größe und Tests'),
  'anchor.install': t('Link to section: Install', 'Link zum Abschnitt: Installation'),
  'anchor.api': t('Link to section: API', 'Link zum Abschnitt: API'),
  'anchor.errors': t('Link to section: Errors', 'Link zum Abschnitt: Fehler'),
  'anchor.run': t('Link to section: Run it here', 'Link zum Abschnitt: Hier ausführen'),
  'anchor.options': t('Link to section: Options', 'Link zum Abschnitt: Optionen'),
  'anchor.overload': t('Link to section: Overload', 'Link zum Abschnitt: Überlast'),
  'anchor.large': t('Link to section: Large files', 'Link zum Abschnitt: Große Dateien'),
  'anchor.method': t('Link to section: Benchmark method', 'Link zum Abschnitt: Benchmark-Methode'),

  // Hero
  'hero.pill': t('No runtime dependencies, MIT licensed', 'Keine Laufzeitabhängigkeiten, MIT-Lizenz'),
  'hero.title': t('Write, read and stream <em>big files</em> <i>fast</i>',
    '<em>Große Dateien</em> <i>schnell</i> schreiben, lesen und streamen'),
  'hero.flipLead': t('One API to', 'Eine API zum'),
  'hero.rotate': t(
    '<span><span>process data beyond memory limits</span><span>stream logs</span><span>seek in binary data</span><span>decode while streaming</span><span>sync database tables</span></span>',
    '<span><span>Verarbeiten von Daten über Speichergrenzen hinaus</span><span>Streamen von Logs</span><span>Springen in Binärdaten</span><span>Dekodieren im Stream</span><span>Synchronisieren von Datenbanktabellen</span></span>'),
  'hero.desc': t(
    'Write and stream gigabytes per second and read any offset in microseconds: in the browser, Node.js and Bun, on the native file system, OPFS or in memory. A high-performance binary file I/O stream layer under databases, virtual file systems and caches.',
    'Gigabytes pro Sekunde schreiben und streamen, jeden Offset in Mikrosekunden lesen: im Browser, unter Node.js und Bun, auf dem nativen Dateisystem, in OPFS oder im Speicher. Eine Hochleistungsschicht für binäre Datei-I/O-Streams unter Datenbanken, virtuellen Dateisystemen und Caches.'),
  'hero.chipLabel': t(
    'Measured on OPFS in Chromium, 1 MiB blocks',
    'Gemessen auf OPFS in Chromium, 1-MiB-Blöcke'),
  'hero.chip': t(
    '<span><span>Write: {{chip1m}}</span><span>Streamed read: {{chipStream1m}}</span><span>Seek and read 4 KiB: {{chipSeek}}</span></span>',
    '<span><span>Schreiben: {{chip1m}}</span><span>Gestreamt lesen: {{chipStream1m}}</span><span>Springen und 4 KiB lesen: {{chipSeek}}</span></span>'),
  'anchor.layer': t(
    'Link to section: Where it sits',
    'Link zum Abschnitt: Wo es sitzt'),
  'layer.title': t(
    'The file layer under your data',
    'Die Dateischicht unter Ihren Daten'),
  'layer.desc': t(
    'Browsers give each site a private file system, OPFS, but only as raw handles inside workers. defuss-storage turns them into files that a database, a virtual file system or a cache can build on, and runs the same files on Node.js, Bun and in memory.',
    'Browser geben jeder Website ein privates Dateisystem, OPFS, aber nur als rohe Handles in Workern. defuss-storage macht daraus Dateien, auf denen eine Datenbank, ein virtuelles Dateisystem oder ein Cache aufbauen kann, und betreibt dieselben Dateien unter Node.js, Bun und im Speicher.'),
  'layer.label': t(
    'Layers: your app, your data layer, defuss-storage, the storage backends',
    'Schichten: Ihre App, Ihre Datenschicht, defuss-storage, die Speicher-Backends'),
  'layer.app.eyebrow': t(
    'Your app',
    'Ihre App'),
  'layer.app.name': t(
    'UI, sync, offline mode',
    'UI, Synchronisation, Offline-Modus'),
  'layer.app.meta': t(
    'page',
    'Seite'),
  'layer.data.eyebrow': t(
    'Your data layer',
    'Ihre Datenschicht'),
  'layer.data.name': t(
    'Database engine, virtual file system, cache, search index, event log',
    'Datenbank-Engine, virtuelles Dateisystem, Cache, Suchindex, Ereignisprotokoll'),
  'layer.data.meta': t(
    'records, indexes, transactions',
    'Datensätze, Indizes, Transaktionen'),
  'layer.files.name': t(
    'Files: ordered appends with offsets, exact reads, streams, limits, one owner',
    'Dateien: geordnetes Anhängen mit Offsets, exaktes Lesen, Streams, Limits, ein Besitzer'),
  'layer.files.meta': t(
    'bytes',
    'Bytes'),
  'layer.backends.eyebrow': t(
    'Backend',
    'Backend'),
  'layer.backends.name': t(
    'OPFS in a worker, native files on Node.js and Bun, memory in tests',
    'OPFS im Worker, native Dateien unter Node.js und Bun, Speicher in Tests'),
  'layer.backends.meta': t(
    'disk',
    'Festplatte'),
  'quality.nodeRing': t(
    '148 of 148 tests pass',
    '148 von 148 Tests bestehen'),
  'quality.browsersRing': t(
    '216 of 216 browser tests pass',
    '216 von 216 Browser-Tests bestehen'),
  'quality.coverageRing': t(
    '99.15 percent line coverage',
    '99,15 Prozent Zeilenabdeckung'),
  'quality.depsRing': t(
    'No runtime dependencies',
    'Keine Laufzeitabhängigkeiten'),
  'hero.try': t('Try now<sup aria-hidden="true">*</sup>', 'Jetzt testen<sup aria-hidden="true">*</sup>'),
  'hero.footnote': t(
    '<span aria-hidden="true">*</span> Everything on this page runs in your browser tab, without a backend server. The library is isomorphic: the same API runs on Node.js and Bun, and the same contract tests pass there.',
    '<span aria-hidden="true">*</span> Alles auf dieser Seite läuft in Ihrem Browser-Tab, ohne Backend-Server. Die Bibliothek ist isomorph: Dieselbe API läuft unter Node.js und Bun, und dieselben Vertragstests bestehen dort.'),
  'hero.bench': t('See the benchmarks', 'Zu den Benchmarks'),
  'hero.note': t(
    'Implemented by <a href="https://www.linkedin.com/in/aronhomberg/" target="_blank" rel="noopener">Aron Homberg (kyr0)<svg class="st-icon st-ext" aria-hidden="true"><use href="#i-external"/></svg><span class="sr-only"> (opens in a new tab)</span></a>. Open source (<a href="https://github.com/kyr0/defuss-storage/blob/main/LICENSE" target="_blank" rel="noopener">MIT<svg class="st-icon st-ext" aria-hidden="true"><use href="#i-external"/></svg><span class="sr-only"> (opens in a new tab)</span></a>).',
    'Implementiert von <a href="https://www.linkedin.com/in/aronhomberg/" target="_blank" rel="noopener">Aron Homberg (kyr0)<svg class="st-icon st-ext" aria-hidden="true"><use href="#i-external"/></svg><span class="sr-only"> (öffnet in neuem Tab)</span></a>. Open Source (<a href="https://github.com/kyr0/defuss-storage/blob/main/LICENSE" target="_blank" rel="noopener">MIT<svg class="st-icon st-ext" aria-hidden="true"><use href="#i-external"/></svg><span class="sr-only"> (öffnet in neuem Tab)</span></a>).'),

  // Why
  'why.title': t('What you get', 'Was Sie bekommen'),
  'why.persist.title': t('Files that survive a reload', 'Dateien, die ein Neuladen überstehen'),
  'why.persist.text': t(
    'OPFS keeps bytes on disk, per origin. The adapter uses the synchronous access handles of dedicated workers, in Chromium, Firefox and WebKit.',
    'OPFS speichert Bytes pro Origin auf der Festplatte. Der Adapter nutzt die synchronen Zugriffs-Handles von Dedicated Workers, in Chromium, Firefox und WebKit.'),
  'why.contract.title': t('One contract, three backends', 'Ein Vertrag, drei Backends'),
  'why.contract.text': t(
    'Memory, native files and OPFS pass the same 33 contract cases: code tested against memory runs unchanged on disk.',
    'Speicher, native Dateien und OPFS bestehen dieselben 33 Vertragsfälle: Gegen den Speicher getesteter Code läuft unverändert auf der Festplatte.'),
  'why.fast.title': t('Small writes made cheap', 'Kleine Schreibvorgänge, günstig gemacht'),
  'why.fast.text': t(
    'An opt-in write buffer batches small appends: awaited 4 KiB appends ran {{wbMin}} to {{wbMax}} times faster in Chromium, Firefox and WebKit.',
    'Ein optionaler Schreibpuffer bündelt kleine Anhänge: Abgewartete 4-KiB-Anhänge liefen in Chromium, Firefox und WebKit {{wbMin}}- bis {{wbMax}}-mal schneller.'),
  'why.bounded.title': t('Overload is refused, not buffered', 'Überlast wird abgelehnt, nicht gepuffert'),
  'why.bounded.text': t(
    'A call beyond an open file\'s limits fails at once with <code>QUEUE_FULL</code>, before anything is copied. In our overload test, peak memory fell from {{peakOld}} without these limits to {{peakNew}} with them.',
    'Ein Aufruf über die Limits einer geöffneten Datei scheitert sofort mit <code>QUEUE_FULL</code>, bevor etwas kopiert wird. Im Überlasttest sank der Spitzenspeicher von {{peakOld}} ohne diese Limits auf {{peakNew}} mit ihnen.'),
  'why.owner.title': t('One owner per file', 'Ein Besitzer pro Datei'),
  'why.owner.text': t(
    'Web Locks give each file one owner across workers and tabs. A second opener gets <code>BUSY</code> until the owner closes or its worker ends.',
    'Web Locks geben jeder Datei einen Besitzer über Worker und Tabs hinweg. Ein zweiter Öffner bekommt <code>BUSY</code>, bis der Besitzer schließt oder sein Worker endet.'),
  'why.small.title': t('Small and dependency-free', 'Klein und ohne Abhängigkeiten'),
  'why.small.text': t(
    '{{opfsGzip}} gzipped for the OPFS entry, no runtime dependencies. ESM, CommonJS and TypeScript types included.',
    '{{opfsGzip}} mit gzip für den OPFS-Einstieg, keine Laufzeitabhängigkeiten. ESM, CommonJS und TypeScript-Typen inklusive.'),

  // Flythrough
  'fly.label': t('Open, append, stream, flush', 'Öffnen, anhängen, streamen, sichern'),
  'fly.open': t('Open.', 'Öffnen.'),
  'fly.append': t('Append.', 'Anhängen.'),
  'fly.stream': t('Stream.', 'Streamen.'),
  'fly.flush': t('Flush.', 'Sichern.'),

  // Demo
  'demo.eyebrow': t('Live demo', 'Live-Demo'),
  'demo.title': t('Try it in this browser', 'Probieren Sie es in diesem Browser aus'),
  'demo.desc': t(
    'Each demo runs defuss-storage in a worker on this page, against your browser\'s real OPFS. Nothing leaves your device.',
    'Jede Demo führt defuss-storage in einem Worker auf dieser Seite aus, gegen das echte OPFS Ihres Browsers. Nichts verlässt Ihr Gerät.'),
  'demo.fallback.title': t('Running on memory instead of OPFS', 'Läuft im Speicher statt in OPFS'),
  'demo.tabs': t('Demos', 'Demos'),
  'demo.tab.persist': t('Persistence', 'Persistenz'),
  'demo.tab.persistDesc': t('Append, reload, read', 'Anhängen, neu laden, lesen'),
  'demo.tab.owner': t('Ownership', 'Besitz'),
  'demo.tab.ownerDesc': t('Two workers, one file', 'Zwei Worker, eine Datei'),
  'demo.tab.limits': t('Backpressure', 'Gegendruck'),
  'demo.tab.limitsDesc': t('Admission limits', 'Annahme-Limits'),
  'demo.tab.playground': t('Playground', 'Playground'),
  'demo.tab.playgroundDesc': t('Run your own code', 'Eigenen Code ausführen'),

  'demo.tab.seek': t('Seek', 'Direktzugriff'),
  'demo.backend': t('Storage backend', 'Speicher-Backend'),
  'demo.backendMemory': t('Memory', 'Speicher'),
  'demo.backendFile': t('Filesystem', 'Dateisystem'),
  'demo.fileNoteTitle': t('Native files run in Node.js and Bun', 'Native Dateien laufen in Node.js und Bun'),
  'demo.fileNoteText': t(
    'A web page cannot open files on your disk. In Node.js or Bun, <code>createFileStorage(root)</code> opens native files with the same handle, limits and errors as this demo.',
    'Eine Webseite kann keine Dateien auf Ihrer Festplatte öffnen. In Node.js oder Bun öffnet <code>createFileStorage(root)</code> native Dateien mit demselben Handle, denselben Limits und Fehlern wie diese Demo.'),
  'demo.fileNoteAction': t('See the Node.js setup', 'Zur Node.js-Einrichtung'),
  'demo.pickNote': t(
    'This browser can also write to a folder on your computer: pick one, and this demo writes below it through <code>createDirectoryStorage</code>.',
    'Dieser Browser kann auch in einen Ordner auf Ihrem Computer schreiben: Wählen Sie einen, und diese Demo schreibt darunter mit <code>createDirectoryStorage</code>.'),
  'demo.pickFolder': t('Pick a folder', 'Ordner wählen'),
  'demo.memoryNoteTitle': t('Memory files belong to one worker', 'Speicherdateien gehören einem Worker'),
  'demo.memoryNoteText': t(
    'Each worker has its own memory, so two workers never share a file and neither gets <code>BUSY</code>. Ownership matters where files are shared: in OPFS, across workers and tabs.',
    'Jeder Worker hat seinen eigenen Speicher: Zwei Worker teilen nie eine Datei, und keiner bekommt <code>BUSY</code>. Besitz zählt dort, wo Dateien geteilt werden: in OPFS, über Worker und Tabs hinweg.'),
  'demo.tab.seekDesc': t('A million records', 'Eine Million Datensätze'),
  'anchor.seek': t('Link to demo: Seek', 'Link zur Demo: Direktzugriff'),
  'seek.title': t('Seek through a large file', 'Direktzugriff auf eine große Datei'),
  'seek.text': t('Write up to a million log records. Each append returns its offset, and the receipts form the index. The list reads only the records on screen, each with one <code>readExactly</code> at its offset.', 'Schreiben Sie bis zu einer Million Log-Datensätze. Jedes Anhängen liefert seinen Offset, und die Quittungen bilden den Index. Die Liste liest nur die sichtbaren Datensätze, jeden mit einem <code>readExactly</code> an seinem Offset.'),
  'seek.recordsLabel': t('Number of records', 'Anzahl der Datensätze'),
  'seek.r100k': t('100,000 records', '100.000 Datensätze'),
  'seek.r250k': t('250,000 records', '250.000 Datensätze'),
  'seek.r1m': t('1,000,000 records', '1.000.000 Datensätze'),
  'seek.generate': t('Write records', 'Datensätze schreiben'),
  'seek.progress': t('Write progress', 'Schreibfortschritt'),
  'seek.statRecords': t('records', 'Datensätze'),
  'seek.statSize': t('file size', 'Dateigröße'),
  'seek.statWrite': t('records written per second', 'Datensätze pro Sekunde geschrieben'),
  'seek.statSeek': t('per read at a random offset', 'pro Lesezugriff an zufälligem Offset'),
  'seek.jumpLabel': t('Record number', 'Datensatznummer'),
  'seek.jumpPlaceholder': t('Record number, for example 123456', 'Datensatznummer, zum Beispiel 123456'),
  'seek.jump': t('Seek', 'Springen'),
  'seek.listLabel': t('Records, read from the file as they scroll into view', 'Datensätze, beim Scrollen aus der Datei gelesen'),
  'persist.title': t('A log file that outlives the tab', 'Eine Logdatei, die den Tab überlebt'),
  'persist.text': t(
    'Append a line and see where the bytes landed. Reload the page: the file is still there.',
    'Hängen Sie eine Zeile an und sehen Sie, wo die Bytes landen. Laden Sie die Seite neu: Die Datei ist noch da.'),
  'persist.inputLabel': t('Line to append', 'Anzuhängende Zeile'),
  'persist.placeholder': t('A line of text', 'Eine Zeile Text'),
  'persist.append': t('Append', 'Anhängen'),
  'persist.read': t('Read back', 'Zurücklesen'),
  'persist.truncate': t('Truncate to 0', 'Auf 0 kürzen'),
  'persist.reload': t('Reload page', 'Seite neu laden'),
  'persist.hexFoot': t('The last 256 bytes of the file. Fresh bytes light up.', 'Die letzten 256 Bytes der Datei. Neue Bytes leuchten auf.'),

  'owner.title': t('Two workers, one file', 'Zwei Worker, eine Datei'),
  'owner.text': t(
    'Open <code>shared.bin</code> in A, then in B. B is refused with <code>BUSY</code> while A holds the lock. Close or terminate A, and B gets in.',
    'Öffnen Sie <code>shared.bin</code> in A, dann in B. B wird mit <code>BUSY</code> abgewiesen, solange A den Lock hält. Schließen oder beenden Sie A, dann kommt B hinein.'),
  'owner.workerA': t('Worker A', 'Worker A'),
  'owner.workerB': t('Worker B', 'Worker B'),
  'owner.open': t('Open', 'Öffnen'),
  'owner.close': t('Close', 'Schließen'),
  'owner.terminate': t('Terminate', 'Beenden'),
  'owner.open2': t('Open', 'Öffnen'),
  'owner.close2': t('Close', 'Schließen'),
  'owner.terminate2': t('Terminate', 'Beenden'),
  'owner.log': t('Event log', 'Ereignisprotokoll'),
  'owner.note': t(
    'The same works across tabs: open this page twice.',
    'Das gilt auch über Tabs hinweg: Öffnen Sie diese Seite zweimal.'),

  'limits.title': t(
    'Many appends at once',
    'Viele Anhänge auf einmal'),
  'limits.text': t(
    'Fire appends without <code>await</code>: every call that fits the limits is admitted. Lower a limit below the load, and the extra calls fail at once with <code>QUEUE_FULL</code> instead of piling up in memory.',
    'Senden Sie Anhänge ohne <code>await</code>: Jeder Aufruf, der in die Limits passt, wird angenommen. Senken Sie ein Limit unter die Last, und die übrigen Aufrufe scheitern sofort mit <code>QUEUE_FULL</code>, statt sich im Speicher zu stapeln.'),
  'limits.calls': t('Calls', 'Aufrufe'),
  'limits.ops': t('<code>maxPendingOperations</code>', '<code>maxPendingOperations</code>'),
  'limits.chunk': t('Chunk size', 'Chunk-Größe'),
  'limits.bytes': t('<code>maxPendingWriteBytes</code>', '<code>maxPendingWriteBytes</code>'),
  'limits.fire': t('Fire without <code>await</code>', 'Ohne <code>await</code> senden'),
  'limits.chunks': t(
    'Write with <code>appendChunks</code>',
    'Mit <code>appendChunks</code> schreiben'),
  'limits.cellsLabel': t('One cell per call: admitted, rejected or not sent', 'Eine Zelle pro Aufruf: angenommen, abgelehnt oder nicht gesendet'),
  'limits.legendOk': t('admitted', 'angenommen'),
  'limits.legendFull': t('<code>QUEUE_FULL</code>', '<code>QUEUE_FULL</code>'),
  'limits.legendIdle': t('not sent', 'nicht gesendet'),

  'play.title': t('Write your own', 'Schreiben Sie Ihren eigenen Code'),
  'play.text': t(
    'Edit the script and run it in a fresh worker with the real package; <code>import</code> works as in your app.',
    'Bearbeiten Sie das Skript und führen Sie es in einem neuen Worker mit dem echten Paket aus; <code>import</code> funktioniert wie in Ihrer App.'),
  'play.presetLabel': t('Example', 'Beispiel'),
  'play.preset.chunks': t('Example: appendChunks with 16 in flight', 'Beispiel: appendChunks mit 16 gleichzeitig'),
  'play.preset.owner': t('Example: BUSY and typed errors', 'Beispiel: BUSY und typisierte Fehler'),
  'play.preset.stream': t('Example: stream and checksum', 'Beispiel: Stream und Prüfsumme'),
  'play.preset.errors': t('Example: write buffer and size', 'Beispiel: Schreibpuffer und Größe'),
  'play.reset': t('Reset', 'Zurücksetzen'),
  'play.run': t('Run', 'Ausführen'),
  'play.copy': t('Copy', 'Kopieren'),
  'play.source': t('Script source', 'Quelltext des Skripts'),
  'play.idle': t('Output appears here.', 'Die Ausgabe erscheint hier.'),

  // How it works
  'how.eyebrow': t('How it works', 'So funktioniert es'),
  'how.title': t('One call, from your code to the disk', 'Ein Aufruf, von Ihrem Code bis zur Festplatte'),
  'how.desc': t(
    'Every adapter sits behind the same handle: it copies your input, checks it against the limits and runs calls in order.',
    'Jeder Adapter sitzt hinter demselben Handle: Es kopiert Ihre Eingabe, prüft sie gegen die Limits und führt Aufrufe der Reihe nach aus.'),
  'how.diagramLabel': t('The path of one append through defuss-storage', 'Der Weg eines Anhängens durch defuss-storage'),
  'how.lane.calls': t('Your call', 'Ihr Aufruf'),
  'how.lane.backends': t('Backends', 'Backends'),
  'how.node.code': t('Your code', 'Ihr Code'),
  'how.node.codeMeta': t('worker, Node.js or Bun', 'Worker, Node.js oder Bun'),
  'how.node.handle': t('Input validated', 'Eingabe geprüft'),
  'how.node.handleMeta': t('copied, or taken with <code>transfer</code>', 'kopiert oder mit <code>transfer</code> übernommen'),
  'how.node.admitEyebrow': t('Admission', 'Annahme'),
  'how.node.admit': t('Fits the limits?', 'Passt in die Limits?'),
  'how.node.admitMeta': t('else <code>QUEUE_FULL</code>, nothing copied', 'sonst <code>QUEUE_FULL</code>, nichts kopiert'),
  'how.node.queueEyebrow': t('Queue', 'Warteschlange'),
  'how.node.queue': t('In call order', 'In Aufrufreihenfolge'),
  'how.node.queueMeta': t('optional write buffer', 'optionaler Schreibpuffer'),
  'how.node.result': t('Promise resolves', 'Promise erfüllt'),
  'how.node.memory': t('Memory', 'Speicher'),
  'how.node.memoryMeta': t('per adapter, for tests', 'pro Adapter, für Tests'),
  'how.node.native': t('Native files', 'Native Dateien'),
  'how.node.nativeMeta': t('async or sync I/O', 'asynchrones oder synchrones I/O'),
  'how.node.opfsMeta': t('sync handle, Web Locks', 'Sync-Handle, Web Locks'),
  'how.step1.title': t('Worker started', 'Worker gestartet'),
  'how.step1.text': t(
    'OPFS sync handles exist only in dedicated workers, so the worker owns the files and your page sends it messages.',
    'OPFS-Sync-Handles gibt es nur in Dedicated Workers: Der Worker besitzt die Dateien, Ihre Seite schickt ihm Nachrichten.'),
  'how.step2.title': t('Namespace opened', 'Namensraum geöffnet'),
  'how.step2.text': t(
    '<code>createOPFSStorage({ name })</code> opens a directory; <code>open()</code> takes the file\'s Web Lock and handle.',
    '<code>createOPFSStorage({ name })</code> öffnet ein Verzeichnis; <code>open()</code> nimmt Web Lock und Handle der Datei.'),
  'how.step3.title': t('Receipts returned', 'Quittungen geliefert'),
  'how.step3.text': t(
    'An append resolves with its offset and length, so you index records without asking for the size.',
    'Ein Anhängen liefert Offset und Länge, so indizieren Sie Datensätze, ohne nach der Größe zu fragen.'),
  'how.step4.title': t('Flushed and closed', 'Gesichert und geschlossen'),
  'how.step4.text': t(
    '<code>flush()</code> persists; <code>close()</code> drains the queue and releases the lock.',
    '<code>flush()</code> sichert; <code>close()</code> arbeitet die Warteschlange ab und gibt den Lock frei.'),

  // Performance
  'perf.eyebrow': t('Performance', 'Performance'),
  'perf.title': t('Measured, with the spread', 'Gemessen, mit der Streuung'),
  'perf.desc': t(
    'Medians of five runs on an {{cpu}}; thin lines mark the slowest and fastest run. Pick a runtime and an operation; the table lists every figure of the current release.',
    'Mediane aus fünf Läufen auf einem {{cpu}}; dünne Linien markieren den langsamsten und schnellsten Lauf. Wählen Sie Laufzeit und Operation; die Tabelle listet alle Werte der aktuellen Version.'),
  'perf.runYours': t('Run it in your browser', 'In Ihrem Browser ausführen'),

  // Chart controls
  'chart.runtime': t('Runtime', 'Laufzeit'),
  'chart.label': t('Bar chart of the recorded benchmark figures for the runtime and operation chosen above', 'Balkendiagramm der aufgezeichneten Benchmark-Werte für die oben gewählte Laufzeit und Operation'),
  'chart.nojs': t('This chart is drawn with JavaScript, which did not run here: scripts are off, or the page was opened from disk. <a href="https://storage.defuss.org/">storage.defuss.org</a> shows it.', 'Dieses Diagramm zeichnet JavaScript, das hier nicht lief: Skripte sind aus, oder die Seite wurde von der Festplatte geöffnet. <a href="https://storage.defuss.org/">storage.defuss.org</a> zeigt es.'),
  'chart.operation': t('Operation', 'Operation'),
  'chart.adapter': t('Adapter', 'Adapter'),
  'chart.mAppend': t('Append', 'Anhängen'),
  'chart.mPipelined': t('16 in flight', '16 gleichzeitig'),
  'chart.mStream': t('Stream', 'Stream'),
  'chart.mChecksum': t('Stream + checksum', 'Stream + Prüfsumme'),
  'chart.mReads': t('Random reads', 'Zufälliges Lesen'),
  'chart.aFile': t('Native files', 'Native Dateien'),
  'chart.aMemory': t('Memory', 'Speicher'),
  'chart.tableCaption': t('All recorded figures of the selected runtime and adapter', 'Alle aufgezeichneten Werte der gewählten Laufzeit und des Adapters'),
  'chart.colChunk': t('Chunk', 'Chunk'),
  'chart.colAppend': t('Append MiB/s', 'Anhängen MiB/s'),
  'chart.colPipelined': t('16 in flight MiB/s', '16 gleichzeitig MiB/s'),
  'chart.colStream': t('Stream MiB/s', 'Stream MiB/s'),
  'chart.colChecksum': t('Stream + checksum MiB/s', 'Stream + Prüfsumme MiB/s'),
  'chart.colReadInto': t('<code>readInto</code> 4 KiB, mean µs', '<code>readInto</code> 4 KiB, Mittel µs'),

  // Size and tests
  'quality.eyebrow': t('Size and tests', 'Größe und Tests'),
  'quality.title': t('Small enough to ship, well tested where it actually runs', 'Klein genug zum Ausliefern, gründlich getestet, wo es wirklich läuft'),
  'quality.desc': t(
    'Sizes of the published build. Tests run against the built files on every listed runtime.',
    'Größen des veröffentlichten Builds. Die Tests laufen gegen die gebauten Dateien, auf jeder genannten Laufzeit.'),
  'quality.sizeTitle': t('Code size per entry point', 'Codegröße pro Einstiegspunkt'),
  'quality.sizeDek': t(
    'Each entry with the shared chunk it imports, unminified.',
    'Jeder Einstieg mit dem geteilten Chunk, den er importiert, unminifiziert.'),
  'quality.sizeLabel': t('Bar chart of package size per entry point: raw, gzip and brotli', 'Balkendiagramm der Paketgröße pro Einstiegspunkt: roh, gzip und brotli'),
  'quality.node': t(
    'tests pass on Node.js 20, 24, 26 and Bun',
    'Tests bestehen unter Node.js 20, 24, 26 und Bun'),
  'quality.browsers': t(
    'browser tests pass: 72 each in Chromium, Firefox and WebKit',
    'Browser-Tests bestehen: je 72 in Chromium, Firefox und WebKit'),
  'quality.coverage': t(
    'line coverage of the built modules (99.15%)',
    'Zeilenabdeckung der gebauten Module (99,15 %)'),
  'quality.deps': t('runtime dependencies', 'Laufzeitabhängigkeiten'),

  // Consulting
  'consult.title': t('Need storage that fits your product?', 'Brauchen Sie Speicher, der zu Ihrem Produkt passt?'),
  'consult.desc': t(
    'Aron Homberg wrote defuss-storage and adapts it for teams: custom backends, offline-first data layers and sync, architecture reviews and performance work. Freelance, available worldwide.',
    'Aron Homberg hat defuss-storage geschrieben und passt es für Teams an: eigene Backends, Offline-first-Datenschichten und Synchronisation, Architektur-Reviews und Performance-Arbeit. Freiberuflich, weltweit verfügbar.'),
  'consult.cta': t('Talk to Aron on LinkedIn', 'Aron auf LinkedIn schreiben'),
  'consult.portrait': t('Portrait of Aron Homberg', 'Porträt von Aron Homberg'),
  'consult.portrait2': t('Portrait of Aron Homberg', 'Porträt von Aron Homberg'),

  // Install
  'install.eyebrow': t('Get started', 'Loslegen'),
  'install.title': t('Install it, open a file', 'Installieren, Datei öffnen'),
  'install.desc': t('Runs on Node.js 20.19 or newer, Bun, and any browser with OPFS.', 'Läuft unter Node.js ab 20.19, Bun und in jedem Browser mit OPFS.'),
  'install.pm': t('Package manager', 'Paketmanager'),
  'install.copy': t('Copy', 'Kopieren'),
  'install.examples': t('Examples', 'Beispiele'),
  'install.tab.browser': t('Browser', 'Browser'),
  'install.tab.node': t('Node.js and Bun', 'Node.js und Bun'),
  'install.tab.memory': t('Tests', 'Tests'),
  'install.tab.agent': t('Coding agent', 'Coding-Agent'),
  'install.browserText': t(
    'Run storage in a dedicated module worker. Vite, webpack and esbuild bundle it from this <code>new URL()</code> form.',
    'Betreiben Sie den Speicher in einem Dedicated Module Worker. Vite, webpack und esbuild bündeln ihn aus dieser <code>new URL()</code>-Form.'),
  'install.nodeText': t(
    'The same calls on native files. <code>appendChunks</code> copies a stream of any size with flat memory.',
    'Dieselben Aufrufe auf nativen Dateien. <code>appendChunks</code> kopiert einen Stream beliebiger Größe bei flachem Speicherverbrauch.'),
  'install.memoryText': t(
    'Same contract, no file system: tests run fast, then the code runs unchanged on OPFS or disk.',
    'Derselbe Vertrag ohne Dateisystem: Tests laufen schnell, danach läuft der Code unverändert auf OPFS oder der Festplatte.'),
  'install.agentText': t(
    'Paste this prompt into your coding agent. It points to the repository, so the agent reads the current README.',
    'Fügen Sie diesen Prompt in Ihren Coding-Agenten ein. Er verweist auf das Repository, damit der Agent die aktuelle README liest.'),
  'install.prompt1': t('Add defuss-storage to this app for browser persistence: https://github.com/kyr0/defuss-storage', 'Füge defuss-storage zu dieser App für Persistenz im Browser hinzu: https://github.com/kyr0/defuss-storage'),
  'install.prompt2': t('Read its README first. Create a dedicated module worker that imports createOPFSStorage from "defuss-storage/opfs" and owns all files; the page talks to it with postMessage.', 'Lies zuerst die README. Lege einen Dedicated Module Worker an, der createOPFSStorage aus "defuss-storage/opfs" importiert und alle Dateien besitzt; die Seite spricht per postMessage mit ihm.'),
  'install.prompt3': t('Store records with append() and keep the returned offsets as the index. Use writeBuffer for many small appends and call flush() at commit points.', 'Speichere Datensätze mit append() und behalte die zurückgegebenen Offsets als Index. Nutze writeBuffer für viele kleine Anhänge und rufe flush() an Commit-Punkten auf.'),
  'install.prompt4': t('Handle StorageError codes BUSY, QUEUE_FULL and QUOTA_EXCEEDED, and test the logic against createMemoryStorage().', 'Behandle die StorageError-Codes BUSY, QUEUE_FULL und QUOTA_EXCEEDED und teste die Logik gegen createMemoryStorage().'),
  'install.copyPrompt': t('Copy prompt', 'Prompt kopieren'),

  // API
  'api.eyebrow': t('API', 'API'),
  'api.title': t('Tiny API, big performance impact', 'Kleine API, große Wirkung auf die Performance'),
  'api.desc': t(
    `Adapters create handles; handles do the I/O. The ${github('README.md#api-and-invariants', 'README')} states every invariant in full.`,
    `Adapter erzeugen Handles; Handles erledigen das I/O. Die ${github('README.md#api-and-invariants', 'README')} beschreibt jede Invariante vollständig.`),
  'api.colCall': t('Call', 'Aufruf'),
  'api.colWhat': t('What it guarantees', 'Was er garantiert'),
  'api.open': t('Fails on a missing file unless <code>create: true</code>; never truncates an existing one. Options: <code>readOnly</code>, <code>exclusive</code>, <code>writeBuffer</code>.', 'Scheitert an einer fehlenden Datei, außer mit <code>create: true</code>; kürzt nie eine vorhandene. Optionen: <code>readOnly</code>, <code>exclusive</code>, <code>writeBuffer</code>.'),
  'api.append': t('Picks the end of file and writes in one queued step; resolves with <code>{ offset, byteLength }</code>.', 'Wählt das Dateiende und schreibt in einem eingereihten Schritt; liefert <code>{ offset, byteLength }</code>.'),
  'api.write': t('Copies the input at call time, or takes it with <code>{ transfer: true }</code>. Extending a file fills the gap with zeros.', 'Kopiert die Eingabe beim Aufruf oder übernimmt sie mit <code>{ transfer: true }</code>. Beim Verlängern wird die Lücke mit Nullen gefüllt.'),
  'api.readExactly': t('The full range, or <code>UNEXPECTED_EOF</code>. Never a short read in disguise.', 'Den ganzen Bereich oder <code>UNEXPECTED_EOF</code>. Nie ein verkapptes kurzes Lesen.'),
  'api.readInto': t('Fills your own buffer and returns the count, without allocating.', 'Füllt Ihren eigenen Puffer und gibt die Anzahl zurück, ohne zu allokieren.'),
  'api.stream': t('Async iterable of owned chunks, 64 KiB by default; reads ahead while a slow consumer works.', 'Async Iterable eigener Chunks, standardmäßig 64 KiB; liest voraus, während ein langsamer Verbraucher arbeitet.'),
  'api.truncate': t('Shrinks, or extends with zeros.', 'Kürzt oder verlängert mit Nullen.'),
  'api.flush': t('Asks the backend to persist: a file sync on Node.js, a handle flush on OPFS.', 'Bittet das Backend zu sichern: ein File-Sync unter Node.js, ein Handle-Flush in OPFS.'),
  'api.close': t('Drains queued work, releases ownership. Idempotent and always admitted.', 'Arbeitet eingereihte Aufgaben ab, gibt den Besitz frei. Idempotent und wird immer angenommen.'),
  'api.appendChunks': t('Appends an async iterable chunk by chunk, with up to <code>inFlight</code> appends at once, and yields receipts in order.', 'Hängt ein Async Iterable Chunk für Chunk an, mit bis zu <code>inFlight</code> gleichzeitigen Anhängen, und liefert Quittungen in Reihenfolge.'),
  'api.errorsTitle': t('Errors you can switch on', 'Fehler, auf die Sie reagieren können'),
  'api.errorsText': t('Every operational failure is a <code>StorageError</code> with one of twelve codes. Match the code, not the class: it survives module and realm boundaries.', 'Jeder Betriebsfehler ist ein <code>StorageError</code> mit einem von zwölf Codes. Prüfen Sie den Code, nicht die Klasse: Er übersteht Modul- und Realm-Grenzen.'),

  // CTA
  'cta.title': t('Give your web app high-performance file I/O', 'Geben Sie Ihrer Web-App schnelles Datei-I/O'),
  'cta.desc': t(
    'One package, no dependencies, MIT licensed. Read the source, run the tests, measure it on your own machine.',
    'Ein Paket, keine Abhängigkeiten, MIT-Lizenz. Lesen Sie den Quelltext, führen Sie die Tests aus, messen Sie auf Ihrem eigenen Gerät.'),
  'cta.github': t('View on GitHub', 'Auf GitHub ansehen'),
  'cta.npm': t('View on npm', 'Auf npm ansehen'),
  'cta.note': t('MIT license.', 'MIT-Lizenz.'),

  // Live benchmark
  'run.rotate': t('<span><span>Run it in this browser</span><span>Measure your own disk</span><span>Compare with the reports</span></span>', '<span><span>In diesem Browser ausführen</span><span>Die eigene Festplatte messen</span><span>Mit den Berichten vergleichen</span></span>'),
  'run.desc': t(
    'Writes 16 MiB four ways in this site\'s OPFS from a worker, reads it back and deletes the file. Takes a few seconds.',
    'Schreibt 16 MiB auf vier Arten in das OPFS dieser Website, aus einem Worker, liest sie zurück und löscht die Datei. Dauert einige Sekunden.'),
  'run.start': t('Start benchmark', 'Benchmark starten'),
  'run.progress': t('Benchmark progress', 'Fortschritt des Benchmarks'),
  'run.chartLabel': t('Bar chart: your results next to the recorded ones', 'Balkendiagramm: Ihre Ergebnisse neben den aufgezeichneten'),
  'run.colCase': t('Case', 'Fall'),
  'run.colYours': t('This browser', 'Dieser Browser'),
  'run.colRecorded': t('Recorded', 'Aufgezeichnet'),
  'options.title': t('What the options buy you', 'Was die Optionen bringen'),
  'options.desc': t(
    'Append throughput per option and runtime. On OPFS the write buffer helps most; <code>inFlight</code> helps native files.',
    'Anhänge-Durchsatz pro Option und Laufzeit. In OPFS hilft der Schreibpuffer am meisten; <code>inFlight</code> hilft nativen Dateien.'),
  'options.label': t('Grouped bar chart of append throughput per option and runtime', 'Gruppiertes Balkendiagramm des Anhänge-Durchsatzes pro Option und Laufzeit'),
  'options.source': t('MiB/s, median of five runs. Node.js and Bun write native files; the browsers write OPFS.', 'MiB/s, Median aus fünf Läufen. Node.js und Bun schreiben native Dateien; die Browser schreiben OPFS.'),
  'overload.title': t('Overload, measured', 'Überlast, gemessen'),
  'overload.desc': t(
    '{{overloadCalls}} appends of {{overloadChunk}} fired without await into the memory adapter on Node.js. 0.2.0 admitted {{overloadAccepted}} and refused {{overloadRejected}} at once; its ArrayBuffer memory peaked at {{peakNew}}, where 0.1.0 buffered every call and reached {{peakOld}}.',
    '{{overloadCalls}} Anhänge zu je {{overloadChunk}}, ohne await in den Speicher-Adapter unter Node.js gesendet. 0.2.0 nahm {{overloadAccepted}} an und lehnte {{overloadRejected}} sofort ab; sein ArrayBuffer-Speicher lag höchstens bei {{peakNew}}, während 0.1.0 jeden Aufruf pufferte und {{peakOld}} erreichte.'),
  'overload.label': t('Bar chart: accepted and rejected calls and peak memory, 0.1.0 and 0.2.0', 'Balkendiagramm: angenommene und abgelehnte Aufrufe und Spitzenspeicher, 0.1.0 und 0.2.0'),
  'large.title': t('Too big for the heap? No problem.', 'Zu groß für den Heap? Kein Problem.'),
  'large.desc': t(
    'Memory follows the chunk size, not the file size. Each handle admits a bounded amount of pending write data (64 MiB by default) and rejects the excess with <code>QUEUE_FULL</code> instead of buffering it, and <code>appendChunks</code> keeps one pull and one append outstanding. Reading back, a stream holds one chunk, plus at most one read ahead while your code works on the last. Files many times the size of the JavaScript heap pass through with flat memory.',
    'Der Speicher richtet sich nach der Chunk-Größe, nicht nach der Dateigröße. Jedes Handle nimmt nur eine begrenzte Menge ausstehender Schreibdaten an (standardmäßig 64 MiB) und lehnt den Rest mit <code>QUEUE_FULL</code> ab, statt ihn zu puffern, und <code>appendChunks</code> hält je einen Pull und ein Append offen. Beim Zurücklesen hält ein Stream einen Chunk, plus höchstens einen vorausgelesenen, während Ihr Code den letzten verarbeitet. Dateien, die ein Vielfaches des JavaScript-Heaps groß sind, laufen mit flachem Speicherverbrauch durch.'),
  'large.file': t('file written and streamed back', 'Datei geschrieben und zurückgestreamt'),
  'large.heap': t('V8 heap limit of the process', 'V8-Heap-Limit des Prozesses'),
  'large.rss': t('peak resident memory', 'höchster residenter Speicher'),
  'large.note': t(
    'Measured in one Node.js process: written in 1 MiB chunks, streamed back with SHA-256. Bars to scale with the file.',
    'Gemessen in einem Node.js-Prozess: in 1-MiB-Chunks geschrieben, mit SHA-256 zurückgestreamt. Balken maßstabsgetreu zur Datei.'),
  'method.title': t('Benchmark method', 'Benchmark-Methode'),
  'method.text': t(
    `Measured on an {{cpu}} ({{cpus}} logical CPUs, macOS, {{benchDate}}) with a warm page cache: five runs of 32&nbsp;MiB per case; charts show the median and the slowest and fastest run. Browsers ran under Playwright with fine-grained timers, while the live benchmark here averages over many calls; the raw reports are in ${github('benchmarks', 'benchmarks/')}.`,
    `Gemessen auf einem {{cpu}} ({{cpus}} logische CPUs, macOS, {{benchDate}}) mit warmem Page Cache: fünf Läufe über 32&nbsp;MiB pro Fall; die Diagramme zeigen den Median sowie den langsamsten und schnellsten Lauf. Die Browser liefen unter Playwright mit feinen Timern, der Live-Benchmark hier mittelt über viele Aufrufe; die Rohberichte liegen in ${github('benchmarks', 'benchmarks/')}.`),

  // Not found
  'missing.title': t('This page does not exist', 'Diese Seite gibt es nicht'),
  'missing.text': t('The address may be mistyped, or the page moved. The demos and benchmarks are one click away.', 'Die Adresse ist vielleicht vertippt oder die Seite umgezogen. Demos und Benchmarks sind einen Klick entfernt.'),
  'missing.home': t('Go to the start page', 'Zur Startseite'),
  'missing.bench': t('Benchmarks', 'Benchmarks'),

  // Footer
  'footer.label': t('Footer', 'Fußzeile'),
  'footer.project': t('Project', 'Projekt'),
  'footer.source': t('Source code', 'Quelltext'),
  'footer.changelog': t('Changelog', 'Änderungen'),
  'footer.validation': t('Validation report', 'Validierungsbericht'),
  'footer.arch': t('Architecture', 'Architektur'),
  'footer.site': t('This site', 'Diese Website'),
  'footer.demo': t('Live demo', 'Live-Demo'),
  'footer.how': t('How it works', 'So funktioniert es'),
  'footer.benchmarks': t('Benchmarks', 'Benchmarks'),
  'footer.install': t('Install', 'Installation'),
  'footer.built': t('Built with', 'Erstellt mit'),
  'footer.consulting': t('Professional services', 'Professionelle Dienstleistungen'),
  'footer.adLabel': t('Consulting by Aron Homberg', 'Beratung von Aron Homberg'),
  'footer.adRole': t('Freelance AI and web tech expert', 'Freiberuflicher KI- und WebTech-Experte'),
  'footer.adCta': t('Connect on LinkedIn', 'Auf LinkedIn vernetzen'),
  'footer.top': t('Back to the top', 'Zurück nach oben'),
  'footer.top2': t('Back to the top', 'Zurück nach oben'),
  'footer.copy': t(
    'Copyright 2026 <a href="https://www.linkedin.com/in/aronhomberg/" target="_blank" rel="noopener">Aron Homberg (kyr0)</a>. Code under the MIT license.',
    'Copyright 2026 <a href="https://www.linkedin.com/in/aronhomberg/" target="_blank" rel="noopener">Aron Homberg (kyr0)</a>. Code unter MIT-Lizenz.'),
};
