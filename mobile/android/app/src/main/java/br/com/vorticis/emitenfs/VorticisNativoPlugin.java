package br.com.vorticis.emitenfs;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.print.PdfExportador;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FileInputStream;
import java.net.URL;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import java.net.HttpURLConnection;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

/**
 * Recursos nativos do Vorticis Emite NFS:
 *  - http: requisições HTTPS com autenticação mútua (certificado A1 ICP-Brasil .pfx) para a Sefin Nacional/ADN
 *  - salvar: grava arquivos (XML, CSV, PDF, backup) em Downloads/Vorticis
 *  - compartilhar: abre o compartilhamento do Android (e-mail, WhatsApp, Drive…)
 *  - imprimir: serviço de impressão do sistema (inclui "Salvar como PDF")
 *  - pdf: gera o PDF A4 de um HTML diretamente (DANFSe), sem diálogo
 */
@CapacitorPlugin(name = "VorticisNativo")
public class VorticisNativoPlugin extends Plugin {

    private WebView webViewImpressao;

    @PluginMethod
    public void http(PluginCall call) {
        String url = call.getString("url");
        String metodo = call.getString("method", "GET");
        String corpo = call.getString("body");
        String pfx = call.getString("pfx");
        String senha = call.getString("senha", "");
        JSObject cabecalhos = call.getObject("headers", new JSObject());
        boolean publico = Boolean.TRUE.equals(call.getBoolean("publico", false));
        HttpURLConnection con = null;
        try {
            if (url == null || !(url.startsWith("https://") || (publico && url.startsWith("http://")))) {
                call.reject("Somente conexões HTTPS são permitidas (HTTP apenas para download público de cadeia de certificados).");
                return;
            }
            con = (HttpURLConnection) new URL(url).openConnection();
            if (pfx != null && !pfx.isEmpty() && con instanceof HttpsURLConnection) {
                KeyStore ks = KeyStore.getInstance("PKCS12");
                ks.load(new ByteArrayInputStream(Base64.decode(pfx, Base64.DEFAULT)), senha.toCharArray());
                KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
                kmf.init(ks, senha.toCharArray());
                SSLContext ctx = SSLContext.getInstance("TLS");
                ctx.init(kmf.getKeyManagers(), null, null);
                ((HttpsURLConnection) con).setSSLSocketFactory(ctx.getSocketFactory());
            }
            con.setRequestMethod(metodo);
            con.setConnectTimeout(30000);
            con.setReadTimeout(90000);
            con.setRequestProperty("User-Agent", "VorticisEmiteNFS-Android");
            Iterator<String> it = cabecalhos.keys();
            while (it.hasNext()) {
                String k = it.next();
                con.setRequestProperty(k, cabecalhos.getString(k));
            }
            if (corpo != null && !corpo.isEmpty()) {
                byte[] dados = Base64.decode(corpo, Base64.DEFAULT);
                con.setDoOutput(true);
                con.setFixedLengthStreamingMode(dados.length);
                try (OutputStream os = con.getOutputStream()) { os.write(dados); }
            }
            int status = con.getResponseCode();
            InputStream is = status >= 400 ? con.getErrorStream() : con.getInputStream();
            byte[] resp = is != null ? ler(is) : new byte[0];
            JSObject h = new JSObject();
            for (Map.Entry<String, List<String>> e : con.getHeaderFields().entrySet()) {
                if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) h.put(e.getKey().toLowerCase(), e.getValue().get(0));
            }
            JSObject ret = new JSObject();
            ret.put("status", status);
            ret.put("headers", h);
            ret.put("body", Base64.encodeToString(resp, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (java.io.IOException e) {
            String msg = e.getMessage() != null ? e.getMessage() : e.toString();
            String m = msg.toLowerCase();
            if (m.contains("password") || m.contains("integrity") || m.contains(" mac")) call.reject("Senha do certificado incorreta ou arquivo inválido.");
            else call.reject("Falha de comunicação com " + Uri.parse(url).getHost() + ": " + msg);
        } catch (Exception e) {
            call.reject("Erro na requisição segura: " + e.getMessage());
        } finally {
            if (con != null) con.disconnect();
        }
    }

    @PluginMethod
    public void salvar(PluginCall call) {
        String nome = call.getString("nome", "arquivo");
        String tipo = call.getString("tipo", "application/octet-stream");
        boolean abrir = Boolean.TRUE.equals(call.getBoolean("abrir", false));
        try {
            byte[] dados = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
            Uri uri;
            String local;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, nome);
                v.put(MediaStore.Downloads.MIME_TYPE, tipo);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Vorticis");
                ContentResolver cr = getContext().getContentResolver();
                uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("Não foi possível criar o arquivo em Downloads.");
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(dados); }
                local = "Downloads/Vorticis/" + nome;
            } else {
                File f = arquivoTemporario(nome, dados);
                uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                local = "";
                compartilharUri(uri, tipo);
            }
            if (abrir) {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, tipo);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try { getContext().startActivity(i); } catch (Exception ignorado) { /* sem app para abrir */ }
            }
            JSObject ret = new JSObject();
            ret.put("local", local);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Falha ao salvar: " + e.getMessage());
        }
    }

    @PluginMethod
    public void compartilhar(PluginCall call) {
        try {
            byte[] dados = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
            File f = arquivoTemporario(call.getString("nome", "arquivo"), dados);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            compartilharUri(uri, call.getString("tipo", "application/octet-stream"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao compartilhar: " + e.getMessage());
        }
    }

    @PluginMethod
    public void imprimir(PluginCall call) {
        String html = call.getString("html", "");
        String titulo = call.getString("titulo", "Vorticis Emite NFS");
        getActivity().runOnUiThread(() -> {
            webViewImpressao = new WebView(getActivity());
            webViewImpressao.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(titulo);
                    pm.print(titulo, adapter, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                    call.resolve();
                }
            });
            webViewImpressao.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
    }

    // Gera o PDF (A4) do HTML informado, sem diálogo – usado para o DANFSe em PDF
    private WebView webViewPdf;

    @PluginMethod
    public void pdf(PluginCall call) {
        String html = call.getString("html", "");
        getActivity().runOnUiThread(() -> {
            webViewPdf = new WebView(getActivity());
            webViewPdf.getSettings().setJavaScriptEnabled(false);
            webViewPdf.setWebViewClient(new WebViewClient() {
                private boolean feito = false;
                @Override
                public void onPageFinished(WebView view, String url) {
                    if (feito) return;
                    feito = true;
                    try {
                        File destino = File.createTempFile("danfse", ".pdf", getContext().getCacheDir());
                        PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS).build();
                        PdfExportador.exportar(view.createPrintDocumentAdapter("DANFSe"), attrs, destino, new PdfExportador.Retorno() {
                            @Override public void ok(File arquivo) {
                                try {
                                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                                    try (InputStream in = new FileInputStream(arquivo)) { byte[] b = new byte[16384]; int n; while ((n = in.read(b)) > 0) buf.write(b, 0, n); }
                                    byte[] bytes = buf.toByteArray();
                                    arquivo.delete();
                                    JSObject r = new JSObject();
                                    r.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                                    call.resolve(r);
                                } catch (Exception e) { call.reject("Falha ao ler o PDF: " + e.getMessage()); }
                                webViewPdf = null;
                            }
                            @Override public void erro(String m) { call.reject("Falha ao gerar o PDF: " + m); webViewPdf = null; }
                        });
                    } catch (Exception e) { call.reject("Falha ao gerar o PDF: " + e.getMessage()); webViewPdf = null; }
                }
            });
            webViewPdf.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
    }

    private void compartilharUri(Uri uri, String tipo) {
        Intent envio = new Intent(Intent.ACTION_SEND);
        envio.setType(tipo);
        envio.putExtra(Intent.EXTRA_STREAM, uri);
        envio.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(envio, "Compartilhar");
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
    }

    private File arquivoTemporario(String nome, byte[] dados) throws Exception {
        File dir = new File(getContext().getCacheDir(), "exportados");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Sem acesso ao cache.");
        File f = new File(dir, nome.replaceAll("[\\\\/:*?\"<>|]", "_"));
        try (FileOutputStream fos = new FileOutputStream(f)) { fos.write(dados); }
        return f;
    }

    private static byte[] ler(InputStream is) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        is.close();
        return bos.toByteArray();
    }
}
