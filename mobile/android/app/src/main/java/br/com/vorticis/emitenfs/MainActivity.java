package br.com.vorticis.emitenfs;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VorticisNativoPlugin.class);
        super.onCreate(savedInstanceState);
        // Botão "voltar": navega no histórico do app; na tela inicial pede confirmação antes de fechar
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null && wv.canGoBack()) { wv.goBack(); return; }
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Fechar o Vorticis Emite NFS")
                    .setMessage("Deseja realmente sair do sistema?")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Sair", (d, w) -> finish())
                    .show();
            }
        });
    }
}
