// OscSurfaceBridgeEditor.cs — OscSurfaceBridge のインスペクタに補足説明を表示する。
// エディタ表示のみの補助であり、docs/UNITY_PROTOCOL.md のプロトコル参照実装には含まれない。
using UnityEditor;

[CustomEditor(typeof(OscSurfaceBridge))]
public sealed class OscSurfaceBridgeEditor : Editor
{
    public override void OnInspectorGUI()
    {
        EditorGUILayout.HelpBox(
            "Character Name はデモ・検証用の表示名です。\n"
            + "マニフェストエントリの label / string 初期値に含まれる {characterName} を"
            + "この値で置き換えます。プレースホルダを使っていなければ動作に影響しません。",
            MessageType.Info);
        DrawDefaultInspector();
    }
}
