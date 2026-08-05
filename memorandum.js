document.addEventListener("DOMContentLoaded", async () => {
  Egov.initNavigation();

  const data = await Egov.loadAll();
  const settings = Egov.applySettings(data.SiteSettings);
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const item = Egov.published(data.Memorandums || []).find((record) => String(record.id) === String(id));

  const loading = document.getElementById("memorandumLoading");
  const stage = document.getElementById("memorandumPaperStage");
  const error = document.getElementById("memorandumError");

  if (!item) {
    loading.classList.add("hidden");
    error.classList.remove("hidden");
    return;
  }

  const subject = String(item.subject || item.title || "Memorandum").trim();
  const memoTo = String(item.memoTo || "Mga Kinauukulang Tanggapan").trim();
  const memoFrom = String(item.memoFrom || "Tanggapan ng Alkalde").trim();
  const signatoryName = String(item.signatoryName || settings.defaultSignatoryName || settings.mayorName || "").trim();
  const signatoryPosition = String(item.signatoryPosition || settings.defaultSignatoryPosition || "Alkalde ng Lungsod ng Los Santos").trim();

  document.getElementById("memorandumNumber").textContent = item.number || "MEMORANDUM";
  document.getElementById("memorandumTo").textContent = memoTo;
  document.getElementById("memorandumFrom").textContent = memoFrom;
  document.getElementById("memorandumSubject").textContent = subject;
  document.getElementById("memorandumDate").textContent = formatMemorandumDate(item.date);
  document.getElementById("memorandumContent").innerHTML = Egov.documentContentToHtml(item.content);
  document.getElementById("memorandumSignatoryName").textContent = signatoryName;
  document.getElementById("memorandumSignatoryPosition").textContent = signatoryPosition;

  const watermarkUrl = Egov.imageUrl(item.watermarkImage || settings.defaultMemorandumWatermarkUrl || settings.logoUrl);
  const watermark = document.getElementById("memorandumWatermark");
  if (watermarkUrl) {
    watermark.src = watermarkUrl;
    watermark.classList.remove("hidden");
    watermark.onerror = () => watermark.classList.add("hidden");
  }

  const signatureUrl = Egov.imageUrl(item.signatureImage || settings.defaultSignatureImageUrl);
  const signatureImage = document.getElementById("memorandumSignatureImage");
  if (signatureUrl) {
    signatureImage.src = signatureUrl;
    signatureImage.classList.remove("hidden");
    signatureImage.onerror = () => signatureImage.classList.add("hidden");
  }

  const externalUrl = Egov.safeUrl(item.url);
  const externalLink = document.getElementById("memorandumExternalLink");
  if (externalUrl !== "#") {
    externalLink.href = externalUrl;
    externalLink.classList.remove("hidden");
  }

  document.title = `${item.number || "Memorandum"} — ${settings.siteTitle || "Los Santos eGov"}`;
  loading.classList.add("hidden");
  stage.classList.remove("hidden");

  document.getElementById("printMemorandumButton").addEventListener("click", () => window.print());
});

function formatMemorandumDate(dateValue) {
  if (!dateValue) return "Walang nakatalang petsa";
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateValue);
  const months = [
    "Enero", "Pebrero", "Marso", "Abril", "Mayo", "Hunyo",
    "Hulyo", "Agosto", "Setyembre", "Oktubre", "Nobyembre", "Disyembre"
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
