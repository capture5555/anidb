"""hermes-agent の x_search_tool を Hermes エージェントループ抜きで直接呼ぶ薄いラッパ。

実行例:
    uvx --from hermes-agent python scripts/x_search_query.py "<query>"

argv[1] のクエリを x_search_tool に渡し、得られた生のレスポンス(JSON文字列)を
そのまま stdout に出力する。x_search_tool が dict を返す場合に備えて json.dumps で
正規化する。あらゆる失敗は {"success": false, "error": "..."} の JSON を出力して
終了コード 0 のまま返す（呼び出し側の Node スクリプトを落とさないため）。

stdlib のみ。hermes 環境(uvx --from hermes-agent)の python で実行される前提。
"""
import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "missing query argument"}))
        return

    query = sys.argv[1]
    try:
        from tools.x_search_tool import x_search_tool  # type: ignore

        result = x_search_tool(query)
        # x_search_tool は JSON 文字列を返す想定だが、dict 等で返ることも考慮する。
        if isinstance(result, str):
            sys.stdout.write(result)
        else:
            sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001 - あらゆる失敗を JSON で包んで返す
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
