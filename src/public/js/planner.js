document.addEventListener('DOMContentLoaded', () => {
  const xmlFiles = document.getElementById('xmlFiles');
  const fileSummary = document.getElementById('fileSummary');
  const xmlForm = document.getElementById('xmlForm');

  if (xmlFiles && fileSummary) {
    xmlFiles.addEventListener('change', () => {
      const files = Array.from(xmlFiles.files || []);
      if (!files.length) {
        fileSummary.textContent = 'Nenhum arquivo selecionado.';
        return;
      }
      const names = files.slice(0, 5).map((file) => file.name);
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const totalMb = totalBytes / (1024 * 1024);
      fileSummary.textContent = `${files.length} XML${files.length > 1 ? 's' : ''} · ${totalMb.toFixed(2)} MB: ${names.join(', ')}${files.length > names.length ? ` e mais ${files.length - names.length}` : ''}`;
      fileSummary.dataset.tooLarge = totalBytes > 4 * 1024 * 1024 ? '1' : '0';
      if (fileSummary.dataset.tooLarge === '1') fileSummary.textContent += ' — divida em lotes menores que 4 MB para publicar na Vercel.';
    });
  }

  if (xmlForm) {
    xmlForm.addEventListener('submit', (event) => {
      if (fileSummary?.dataset.tooLarge === '1') {
        event.preventDefault();
        alert('Este lote ultrapassa 4 MB. Divida os XMLs em dois ou mais lotes; as paradas já importadas continuarão no planejamento.');
        return;
      }
      const button = xmlForm.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
        button.textContent = 'Importando...';
      }
    });
  }

  document.querySelectorAll('[data-toggle-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const panel = document.getElementById(button.dataset.togglePanel);
      if (!panel) return;
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
});
