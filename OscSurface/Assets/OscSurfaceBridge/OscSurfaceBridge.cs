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

    // §4.1 受信統計
    private int received;
    private int parseErrors; // uOSC は decode 失敗を通知しないため常に 0 を報告する(付録 A.4)
    private string lastReceivedAt = "1970-01-01T00:00:00.000Z"; // ISO-8601 UTC(Z 終端)

    // §4.3 現在値ストア(マニフェスト default 用)
    private readonly Dictionary<string, object> currentValues = new Dictionary<string, object>();

    private uOscServer server;
    private uOscClient client; // 全送信の出口 = 設定された返信先(§4.4)

    // §4.3 エントリ定義(何を操作可能として公開するか)
    private readonly struct EntryDef
    {
        public readonly string Address;
        public readonly string Label;
        public readonly string Type;
        public readonly string Widget;
        public readonly object Initial; // null = default を持たない
        public readonly string Group;   // null = group を省略
        public readonly bool HasRange;
        public readonly float RangeMin;
        public readonly float RangeMax;

        public EntryDef(string address, string label, string type, string widget,
            object initial = null, string group = null,
            bool hasRange = false, float rangeMin = 0f, float rangeMax = 0f)
        {
            Address = address;
            Label = label;
            Type = type;
            Widget = widget;
            Initial = initial;
            Group = group;
            HasRange = hasRange;
            RangeMin = rangeMin;
            RangeMax = rangeMax;
        }
    }

    private static readonly EntryDef[] EntryDefs =
    {
        new EntryDef("/avatar/blend/smile", "{characterName} Smile", "f", "fader", 0.35f, "Face", true, 0f, 1f),
        new EntryDef("/avatar/text/name", "Character Name", "s", "text", "{characterName}", "Profile"),
        new EntryDef("/avatar/generated/greeting", "Greeting", "s", "text", "{characterName}です", "Profile"),
        new EntryDef("/avatar/toggle/visible", "Visible", "bool", "toggle", true),
        new EntryDef("/avatar/generated/wave", "Wave", "i", "button", 1, "Motion"),
    };

    private void Awake()
    {
        // 起動直後の現在値をエントリ定義の初期値で埋める(§4.3)
        foreach (var def in EntryDefs)
        {
            if (def.Initial != null)
            {
                currentValues[def.Address] = ResolveInitial(def.Initial);
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
        client.Send("/sys/manifest", BuildManifestJson());
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
        foreach (var def in EntryDefs)
        {
            if (def.Address == address && TypeMatches(def.Type, value))
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
    private string BuildManifestJson()
    {
        var sb = new StringBuilder();
        sb.Append("{\"version\":1,\"entries\":[");

        for (var i = 0; i < EntryDefs.Length; i++)
        {
            var def = EntryDefs[i];

            if (i > 0)
            {
                sb.Append(',');
            }

            sb.Append("{\"address\":").Append(Quote(def.Address));
            sb.Append(",\"label\":").Append(Quote(ApplyCharacterName(def.Label)));
            sb.Append(",\"type\":").Append(Quote(def.Type));
            sb.Append(",\"widget\":").Append(Quote(def.Widget));

            if (def.HasRange)
            {
                sb.Append(",\"range\":[").Append(FormatNumber(def.RangeMin))
                    .Append(',').Append(FormatNumber(def.RangeMax)).Append(']');
            }

            if (currentValues.TryGetValue(def.Address, out var current))
            {
                sb.Append(",\"default\":").Append(JsonValue(current)); // 現在値を default として埋める(§2)
            }

            if (def.Group != null)
            {
                sb.Append(",\"group\":").Append(Quote(def.Group));
            }

            sb.Append('}');
        }

        sb.Append("]}");
        return sb.ToString();
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
