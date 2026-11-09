package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * Grava em arquivo PDF o documento de um PrintDocumentAdapter (ex.: WebView), sem abrir o diálogo de impressão.
 * Fica no pacote android.print porque os construtores dos callbacks de layout/escrita são package-private.
 */
public class PdfExportador {
    public interface Retorno { void ok(File arquivo); void erro(String mensagem); }

    public static void exportar(final PrintDocumentAdapter adapter, PrintAttributes atributos, final File destino, final Retorno retorno) {
        adapter.onLayout(null, atributos, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean mudou) {
                final ParcelFileDescriptor pfd;
                try {
                    pfd = ParcelFileDescriptor.open(destino, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                } catch (Exception e) { retorno.erro(e.getMessage()); return; }
                adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, pfd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                    @Override public void onWriteFinished(PageRange[] paginas) { fechar(pfd); adapter.onFinish(); retorno.ok(destino); }
                    @Override public void onWriteFailed(CharSequence erro) { fechar(pfd); adapter.onFinish(); retorno.erro(String.valueOf(erro)); }
                    @Override public void onWriteCancelled() { fechar(pfd); adapter.onFinish(); retorno.erro("cancelado"); }
                });
            }
            @Override public void onLayoutFailed(CharSequence erro) { retorno.erro(String.valueOf(erro)); }
            @Override public void onLayoutCancelled() { retorno.erro("cancelado"); }
        }, null);
    }

    private static void fechar(ParcelFileDescriptor pfd) { try { pfd.close(); } catch (Exception ignorado) { } }
}
