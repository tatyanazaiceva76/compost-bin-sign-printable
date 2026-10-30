import { createPdfArtifact, exportProjectJson, parseItemLines, parseProjectJson, ProjectError, trimSegments } from './core.mjs';
import { resetProjectForm } from './controller.mjs';
import { NOTO_SANS_BASE64 } from './noto-sans-data.mjs';

const $ = (id) => document.getElementById(id);
const form = $('project-form');
const binList = $('bin-list');
const preview = $('preview');
const errorBox = $('error');
const summary = $('summary');
const downloadButton = $('download-pdf');
let revision = 0;
let currentPdfUrl = null;
let bins = [{ title: '', acceptedText: '', excludedText: '', copies: 1 }];

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
const fontBytes = bytesFromBase64(NOTO_SANS_BASE64);

function element(name, attributes = {}, text = '') {
  const node = document.createElement(name);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function invalidate(message = 'Inputs changed. Generate again for a current preview and PDF.') {
  revision += 1;
  if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
  currentPdfUrl = null;
  downloadButton.disabled = true;
  preview.replaceChildren();
  summary.textContent = message;
  errorBox.hidden = true;
}

function renderBins() {
  binList.replaceChildren();
  bins.forEach((bin, index) => {
    const card = element('fieldset', { className: 'bin-card', 'data-index': String(index) });
    card.append(element('legend', {}, `Bin ${index + 1}`));
    const titleLabel = element('label', {}, 'Bin title');
    const title = element('input', { type: 'text', maxlength: '80', required: '', 'data-field': 'title', value: bin.title });
    title.value = bin.title;
    titleLabel.append(title);
    const acceptedLabel = element('label', {}, 'Accepted lines - one per line');
    const accepted = element('textarea', { rows: '5', maxlength: '3000', 'data-field': 'acceptedText' });
    accepted.value = bin.acceptedText;
    acceptedLabel.append(accepted);
    const excludedLabel = element('label', {}, 'Excluded lines - one per line');
    const excluded = element('textarea', { rows: '5', maxlength: '3000', 'data-field': 'excludedText' });
    excluded.value = bin.excludedText;
    excludedLabel.append(excluded);
    const copiesLabel = element('label', {}, 'Copies');
    const copies = element('input', { type: 'number', min: '1', max: '32', step: '1', required: '', 'data-field': 'copies' });
    copies.value = String(bin.copies);
    copiesLabel.append(copies);
    const remove = element('button', { type: 'button', className: 'danger', 'data-action': 'remove' }, 'Remove bin');
    remove.disabled = bins.length === 1;
    card.append(titleLabel, acceptedLabel, excludedLabel, copiesLabel, remove);
    binList.append(card);
  });
}

function syncBinsFromDom() {
  bins = [...binList.querySelectorAll('.bin-card')].map((card) => ({
    title: card.querySelector('[data-field="title"]').value,
    acceptedText: card.querySelector('[data-field="acceptedText"]').value,
    excludedText: card.querySelector('[data-field="excludedText"]').value,
    copies: Number(card.querySelector('[data-field="copies"]').value)
  }));
}

function collectProject() {
  syncBinsFromDom();
  return {
    schemaVersion: 1,
    paper: $('paper').value,
    orientation: $('orientation').value,
    signWidthMm: Number($('sign-width').value),
    signHeightMm: Number($('sign-height').value),
    confirmedLocalRules: $('confirmation').checked,
    bins: bins.map((bin) => ({ title: bin.title, accepted: parseItemLines(bin.acceptedText), excluded: parseItemLines(bin.excludedText), copies: bin.copies }))
  };
}

function applyProject(project) {
  $('paper').value = project.paper;
  $('orientation').value = project.orientation;
  $('sign-width').value = String(project.signWidthMm);
  $('sign-height').value = String(project.signHeightMm);
  $('confirmation').checked = project.confirmedLocalRules;
  bins = project.bins.map((bin) => ({ title: bin.title, acceptedText: bin.accepted.join('\n'), excludedText: bin.excluded.join('\n'), copies: bin.copies }));
  renderBins();
  invalidate('Project loaded. Generate to create a current preview and PDF.');
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function renderPreview(model) {
  preview.replaceChildren();
  model.pages.forEach((pageModel, index) => {
    const figure = element('figure', { className: 'preview-page' });
    const svg = svgNode('svg', { viewBox: `0 0 ${pageModel.pageWidth} ${pageModel.pageHeight}`, role: 'img', 'aria-labelledby': `preview-title-${index} preview-desc-${index}` });
    const title = svgNode('title', { id: `preview-title-${index}` });
    title.textContent = `Sign page ${index + 1}: ${pageModel.title}`;
    const description = svgNode('desc', { id: `preview-desc-${index}` });
    description.textContent = pageModel.elements.filter((item) => item.type === 'text').map((item) => item.text).join('. ');
    svg.append(title, description);
    for (const item of pageModel.elements) {
      if (item.type === 'rect') {
        svg.append(svgNode('rect', { x: item.x, y: item.top, width: item.width, height: item.height, fill: `rgb(${item.fill * 255},${item.fill * 255},${item.fill * 255})`, stroke: `rgb(${item.stroke * 255},${item.stroke * 255},${item.stroke * 255})`, 'stroke-width': item.lineWidth }));
      } else if (item.type === 'text') {
        const group = svgNode('g', { 'aria-label': item.text, role: 'img', fill: `rgb(${item.color * 255},${item.color * 255},${item.color * 255})` });
        for (const glyph of item.glyphs) group.append(svgNode('path', { d: glyph.d, transform: glyph.transform, 'aria-hidden': 'true' }));
        svg.append(group);
      } else if (item.type === 'trim') {
        for (const [x1, y1, x2, y2] of trimSegments(item)) svg.append(svgNode('line', { x1, y1, x2, y2, stroke: '#1a1a1a', 'stroke-width': '0.65', 'aria-hidden': 'true' }));
      }
    }
    figure.append(svg, element('figcaption', {}, `Page ${index + 1} of ${model.totalPages} - copy ${pageModel.copyIndex}`));
    preview.append(figure);
  });
}

function showError(error) {
  errorBox.textContent = error instanceof ProjectError ? `${error.code}: ${error.message}` : `UNEXPECTED_ERROR: ${error.message}`;
  errorBox.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  invalidate('Generating current result...');
  const startedRevision = revision;
  try {
    const artifact = await createPdfArtifact(collectProject(), { PDFLib: globalThis.PDFLib, fontkit: globalThis.fontkit, fontBytes });
    if (startedRevision !== revision) return;
    const blob = new Blob([artifact.pdfBytes], { type: 'application/pdf' });
    currentPdfUrl = URL.createObjectURL(blob);
    downloadButton.disabled = false;
    renderPreview(artifact.model);
    summary.textContent = `${artifact.model.totalPages} page(s), ${artifact.project.bins.length} bin(s). Preview and PDF use the same measured layout model.`;
  } catch (error) { showError(error); summary.textContent = 'No PDF was created. Correct the stated issue and generate again.'; }
});

form.addEventListener('input', (event) => {
  const card = event.target.closest('.bin-card');
  if (card && event.target.dataset.field) syncBinsFromDom();
  invalidate();
});
form.addEventListener('change', (event) => {
  if (event.target !== $('import-json')) invalidate();
});

binList.addEventListener('click', (event) => {
  if (event.target.dataset.action !== 'remove') return;
  syncBinsFromDom();
  const index = Number(event.target.closest('.bin-card').dataset.index);
  bins.splice(index, 1);
  renderBins();
  invalidate('Bin removed. Generate again for a current result.');
});

$('add-bin').addEventListener('click', () => {
  syncBinsFromDom();
  if (bins.length >= 8) return showError(new ProjectError('BIN_COUNT', 'The limit is eight bins.'));
  bins.push({ title: '', acceptedText: '', excludedText: '', copies: 1 });
  renderBins();
  invalidate('Bin added. Generate after completing its fields.');
});

$('use-demo').addEventListener('click', () => applyProject({ schemaVersion: 1, paper: 'A4', orientation: 'portrait', signWidthMm: 170, signHeightMm: 245, confirmedLocalRules: false, bins: [
  { title: 'Example bin A', accepted: ['Example item one', 'Example item two'], excluded: ['Example excluded item'], copies: 2 },
  { title: 'Example bin B', accepted: ['Example item three'], excluded: ['Example excluded item two'], copies: 1 }
]}));

$('reset-project').addEventListener('click', () => {
  bins = [{ title: '', acceptedText: '', excludedText: '', copies: 1 }];
  resetProjectForm(form);
  $('sign-width').value = '170'; $('sign-height').value = '245';
  renderBins();
  invalidate('Reset complete. No result is current.');
});

downloadButton.addEventListener('click', () => {
  if (!currentPdfUrl) return;
  const link = document.createElement('a');
  link.href = currentPdfUrl; link.download = 'compost-bin-sign-set.pdf'; link.click();
});

$('export-json').addEventListener('click', () => {
  try {
    const json = exportProjectJson(collectProject());
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'compost-bin-sign-project.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) { showError(error); }
});

$('import-json').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const importRevision = ++revision;
  invalidate('Reading project JSON...');
  if (file.size > 100000) return showError(new ProjectError('JSON_SIZE', 'Project JSON exceeds 100,000 bytes.'));
  try {
    const text = await file.text();
    if (importRevision + 1 !== revision) return;
    applyProject(parseProjectJson(text));
  } catch (error) { showError(error); summary.textContent = 'Import refused; current form was not replaced.'; }
});

renderBins();
