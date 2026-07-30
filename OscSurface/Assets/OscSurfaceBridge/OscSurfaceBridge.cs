// OscSurfaceBridge.cs — docs/UNITY_PROTOCOL.md 付録 A.2 の参照実装(uOSC 2.2.0)
// 本文 §4(実装指針)の擬似コードを 1:1 で具体化した単一 MonoBehaviour。
// 使い方: 空の GameObject に本コンポーネントを追加し(uOscServer / uOscClient は自動追加される)、
//   - uOscServer.port   = Surface config の unity.sendPort(既定 9000)
//   - uOscClient.address/port = Surface ホスト : unity.receivePort(既定 127.0.0.1 : 9001)
// をインスペクタで設定する(§5.1 のポート対応)。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using uOSC;

[RequireComponent(typeof(uOscServer), typeof(uOscClient))]
public sealed class OscSurfaceBridge : MonoBehaviour
{
    // デモ用の表示名。エントリ定義中の {characterName} を置き換える
    [SerializeField] private string characterName = "UnityBridge";
    [SerializeField] private OscSurfaceManifestAsset manifestAsset;

    // §4.1 受信統計
    private int received;
    private int parseErrors; // uOSC は decode 失敗を通知しないため常に 0 を報告する(付録 A.4)
    private string lastReceivedAt = "1970-01-01T00:00:00.000Z"; // ISO-8601 UTC(Z 終端)

    // §4.3 現在値ストア(マニフェスト default 用)
    private readonly Dictionary<string, object> currentValues = new Dictionary<string, object>();

    private uOscServer server;
    private uOscClient client; // 全送信の出口 = 設定された返信先(§4.4)

    private void Awake()
    {
        // 起動直後の現在値をエントリ定義の初期値で埋める(§4.3)
        if (!TryGetValidatedAsset(out var asset))
        {
            return;
        }

        foreach (var entry in asset.entries)
        {
            if (TryGetDefaultValue(entry, out var initial))
            {
                currentValues[entry.address] = ResolveInitial(initial);
            }
        }
    }

    private void OnEnable()
    {
        server = GetComponent<uOscServer>();
        client = GetComponent<uOscClient>();
        server.onDataReceived.AddListener(OnDataReceived);

        // 要求を受けていなくても起動時に自発送信してよい(§2 / §4.3 補足)
        SendManifest();
    }

    private void OnDisable()
    {
        server.onDataReceived.RemoveListener(OnDataReceived);
    }

    // §4.1 受信処理の骨格。uOSC は bundle を自動展開して展開後メッセージ単位で
    // このコールバックを呼ぶため、bundle 分岐は不要(§4.1 補足 / 付録 A.3)
    private void OnDataReceived(Message message)
    {
        // 計数と時刻更新はディスパッチより先(/sys/stats/request 自身も数える)
        received += 1;
        lastReceivedAt = NowIso8601();

        switch (message.address)
        {
            case "/sys/ping": // §4.2
                if (message.values.Length > 0 && message.values[0] is int seq)
                {
                    SendPong(seq);
                }
                return;
            case "/sys/stats/request": // §4.1
                SendStats();
                return;
            case "/sys/manifest/request": // §4.3
                SendManifest();
                return;
        }

        if (message.address.StartsWith("/sys/", StringComparison.Ordinal))
        {
            return; // 上記以外の /sys/* は計数のみ。応答しない
        }

        HandleNormalMessage(message);
    }

    // §4.2 受信した seq をそのまま即時返信。検査・保持・解釈はしない
    private void SendPong(int seq)
    {
        client.Send("/sys/pong", seq);
    }

    private void SendStats()
    {
        client.Send("/sys/stats", BuildStatsJson());
    }

    private void SendManifest()
    {
        if (TryBuildManifestJson(out var json))
        {
            client.Send("/sys/manifest", json);
        }
    }

    // §4.3 通常メッセージ: 現在値の記録 + 同一アドレスへのエコーバック(§3)
    private void HandleNormalMessage(Message message)
    {
        foreach (var value in message.values)
        {
            if (value is int || value is float || value is string)
            {
                RecordValue(message.address, value);
                break;
            }
        }

        var echoed = new object[message.values.Length];
        for (var i = 0; i < message.values.Length; i++)
        {
            echoed[i] = NormalizeValue(message.values[i]);
        }

        client.Send(message.address, echoed);
    }

    private void RecordValue(string address, object value)
    {
        if (manifestAsset == null || manifestAsset.entries == null)
        {
            return;
        }

        foreach (var entry in manifestAsset.entries)
        {
            if (entry.address == address && TypeMatches(TypeName(entry.type), value))
            {
                currentValues[address] = value;
                return;
            }
        }
    }

    private static bool TypeMatches(string entryType, object value)
    {
        switch (entryType)
        {
            case "i": return value is int;
            case "f": return value is int || value is float;
            case "s": return value is string;
            case "bool": return value is bool; // 値の授受は i の 0/1 のため実運用では更新されない(§2)
            default: return false; // "b"(blob)は値同期の対象外
        }
    }

    // §4.4 真偽値は i の 0/1 で送る(T/F タグを使わない)
    private static object NormalizeValue(object value)
    {
        if (value is bool flag)
        {
            return flag ? 1 : 0;
        }

        return value;
    }

    private string BuildStatsJson()
    {
        return "{\"received\":" + received.ToString(CultureInfo.InvariantCulture)
            + ",\"parseErrors\":" + parseErrors.ToString(CultureInfo.InvariantCulture)
            + ",\"lastReceivedAt\":" + Quote(lastReceivedAt) + "}";
    }

    // §4.3 任意フィールド(range / default / group)は値がないときキーごと省略し、null を書かない
    private bool TryBuildManifestJson(out string json)
    {
        json = null;
        if (!TryGetValidatedAsset(out var asset))
        {
            return false;
        }

        var sb = new StringBuilder();
        sb.Append("{\"version\":1,\"projectId\":").Append(Quote(asset.projectId)).Append(",\"entries\":[");

        for (var i = 0; i < asset.entries.Count; i++)
        {
            var entry = asset.entries[i];

            if (i > 0)
            {
                sb.Append(',');
            }

            sb.Append("{\"address\":").Append(Quote(entry.address));
            sb.Append(",\"label\":").Append(Quote(ApplyCharacterName(entry.label)));
            sb.Append(",\"type\":").Append(Quote(TypeName(entry.type)));
            sb.Append(",\"widget\":").Append(Quote(WidgetName(entry.widget)));

            if (entry.hasRange)
            {
                sb.Append(",\"range\":[").Append(FormatNumber(entry.rangeMin))
                    .Append(',').Append(FormatNumber(entry.rangeMax)).Append(']');
            }

            if (currentValues.TryGetValue(entry.address, out var current))
            {
                sb.Append(",\"default\":").Append(JsonValue(current)); // 現在値を default として埋める(§2)
            }

            if (!string.IsNullOrEmpty(entry.group))
            {
                sb.Append(",\"group\":").Append(Quote(entry.group));
            }

            sb.Append('}');
        }

        sb.Append("]}");
        json = sb.ToString();
        return true;
    }

    private bool TryGetValidatedAsset(out OscSurfaceManifestAsset asset)
    {
        asset = manifestAsset;
        if (asset == null)
        {
            Debug.LogError("OscSurfaceBridge requires an OscSurfaceManifestAsset.", this);
            return false;
        }

        if (string.IsNullOrWhiteSpace(asset.projectId))
        {
            Debug.LogError("OscSurfaceManifestAsset projectId must not be empty.", asset);
            return false;
        }

        if (asset.entries == null)
        {
            Debug.LogError("OscSurfaceManifestAsset entries must not be null.", asset);
            return false;
        }

        foreach (var entry in asset.entries)
        {
            if (entry == null || string.IsNullOrWhiteSpace(entry.address))
            {
                Debug.LogError("OscSurfaceManifestAsset contains an entry with an empty address.", asset);
                return false;
            }

            // 壊れた YAML などで enum に範囲外の値が入っていたら送信を中止する(§4.3)
            if (!Enum.IsDefined(typeof(OscSurfaceManifestAsset.EntryType), entry.type)
                || !Enum.IsDefined(typeof(OscSurfaceManifestAsset.WidgetType), entry.widget)
                || !Enum.IsDefined(typeof(OscSurfaceManifestAsset.DefaultKind), entry.defaultKind))
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset entry \"" + entry.address + "\" has an undefined enum value.", asset);
                return false;
            }
        }

        return true;
    }

    private static bool TryGetDefaultValue(OscSurfaceManifestAsset.Entry entry, out object value)
    {
        switch (entry.defaultKind)
        {
            case OscSurfaceManifestAsset.DefaultKind.Int: value = entry.defaultInt; return true;
            case OscSurfaceManifestAsset.DefaultKind.Float: value = entry.defaultFloat; return true;
            case OscSurfaceManifestAsset.DefaultKind.String: value = entry.defaultString; return true;
            case OscSurfaceManifestAsset.DefaultKind.Bool: value = entry.defaultBool; return true;
            default: value = null; return false;
        }
    }

    private static string TypeName(OscSurfaceManifestAsset.EntryType type)
    {
        switch (type)
        {
            case OscSurfaceManifestAsset.EntryType.Int: return "i";
            case OscSurfaceManifestAsset.EntryType.Float: return "f";
            case OscSurfaceManifestAsset.EntryType.String: return "s";
            case OscSurfaceManifestAsset.EntryType.Blob: return "b";
            case OscSurfaceManifestAsset.EntryType.Bool: return "bool";
            default: return "";
        }
    }

    private static string WidgetName(OscSurfaceManifestAsset.WidgetType widget)
    {
        switch (widget)
        {
            case OscSurfaceManifestAsset.WidgetType.Fader: return "fader";
            case OscSurfaceManifestAsset.WidgetType.Button: return "button";
            case OscSurfaceManifestAsset.WidgetType.Toggle: return "toggle";
            case OscSurfaceManifestAsset.WidgetType.Xy: return "xy";
            case OscSurfaceManifestAsset.WidgetType.Text: return "text";
            default: return "";
        }
    }

    private object ResolveInitial(object initial)
    {
        return initial is string text ? ApplyCharacterName(text) : initial;
    }

    private string ApplyCharacterName(string template)
    {
        return template.Replace("{characterName}", characterName ?? string.Empty);
    }

    private static string NowIso8601()
    {
        return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }

    private static string JsonValue(object value)
    {
        switch (value)
        {
            case int intValue: return intValue.ToString(CultureInfo.InvariantCulture);
            case float floatValue: return FormatNumber(floatValue);
            case bool boolValue: return boolValue ? "true" : "false";
            case string stringValue: return Quote(stringValue);
            default: return Quote(value.ToString());
        }
    }

    private static string FormatNumber(float value)
    {
        return value.ToString("R", CultureInfo.InvariantCulture);
    }

    private static string Quote(string value)
    {
        var sb = new StringBuilder(value.Length + 2);
        sb.Append('"');

        foreach (var ch in value)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < ' ')
                    {
                        sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        sb.Append(ch);
                    }
                    break;
            }
        }

        sb.Append('"');
        return sb.ToString();
    }
}
