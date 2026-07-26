package com.creationation.clouduo;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Doit être enregistré AVANT super.onCreate: le pont est construit là,
        // et un plugin déclaré après ne recevrait pas l'intention de partage
        // qui a lancé l'application.
        registerPlugin(ShareTargetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
