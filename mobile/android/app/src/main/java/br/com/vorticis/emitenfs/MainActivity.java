package br.com.vorticis.emitenfs;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VorticisNativoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
