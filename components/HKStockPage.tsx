'use client';

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  TrendingUp,
  Loader2,
  ArrowUpDown,
  Info,
  Zap,
  AlertTriangle,
  Trophy,
  ChevronRight,
} from "lucide-react";

// ─── 主頁面入口 ───────────────────────────────────────────────────────────────
export default function HKStockPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <span>🇭🇰</span> AI短炒 · 港股量化系統{" "}
          <Badge variant="secondary" className="text-[10px] font-mono ml-1">
            V3.7 旗艦版
          </Badge>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          正宗四階段縱深篩選 · 遺珠死因榜單 · 盤弱降維試槍
        </p>
      </div>

      <Tabs defaultValue="analyze" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="analyze">個股分析</TabsTrigger>
          <TabsTrigger value="scan">系統掃描推介</TabsTrigger>
        </TabsList>

        <TabsContent value="analyze">
          <StockAnalysis market="HK" />
        </TabsContent>
        <TabsContent value="scan">
          <HKScanner />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── 個股分析組件 ────────────────────────────────────────────────────────────
export function StockAnalysis({ market }: { market: "HK" | "US" }) {
  const [symbol, setSymbol] = useState("");
  const [activeSymbol, setActiveSymbol] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSearch = () => {
    if (symbol.trim()) {
      let s = symbol.trim().toUpperCase();
      if (market === "HK" && /^\d{1,5}$/.test(s)) {
        s = s.padStart(4, "0") + ".HK";
      }
      setActiveSymbol(s);
    }
  };

  const placeholder =
    market === "HK"
      ? "輸入港股代碼（例如：0700 或 0700.HK）"
      : "Enter US ticker (e.g., AAPL, NVDA)";

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-9 font-mono"
          />
        </div>
        <Button onClick={handleSearch} disabled={!symbol.trim()}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "分析"
          )}
        </Button>
      </div>

      {!activeSymbol && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">請在上方輸入股票代碼以開始分析</p>
            <p className="text-xs mt-1">
              {market === "HK"
                ? "例如：0700、9988、0005、1810"
                : "Examples: AAPL, NVDA, TSLA, MSFT"}
            </p>
          </CardContent>
        </Card>
      )}

      {activeSymbol && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              {activeSymbol}
              <Badge variant="outline" className="font-mono text-xs">
                {activeSymbol}
              </Badge>
            </CardTitle>
            <CardDescription>港股代碼</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center p-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
              <p className="text-sm">數據載入中...</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── HK 系統掃描器 ────────────────────────────────────────────────────────────
function HKScanner() {
  const [scanMode, setScanMode] = useState<"select" | "linkage" | "risk">(
    "select"
  );
  const [softenerEnabled, setSoftenerEnabled] = useState(false);

  const handleBack = () => {
    setScanMode("select");
  };

  // ─── 模式選擇畫面 ─────────────────────────────────────────────────────────
  if (scanMode === "select") {
    return (
      <div className="space-y-4">
        <SoftenerToggle
          enabled={softenerEnabled}
          onToggle={() => setSoftenerEnabled((prev) => !prev)}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">✨ 港股系統推介</CardTitle>
            <CardDescription>
              選擇推介模式，系統將根據正宗四階縱深篩選，推介信心度最高的即日短炒股票
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <button
              onClick={() => setScanMode("linkage")}
              className="w-full p-4 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/60 hover:border-blue-500/50 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">美股聯動推介</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    根據美股板塊隔夜表現，找出聯動港股機會
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-400 transition-colors" />
              </div>
            </button>

            <button
              onClick={() => setScanMode("risk")}
              className="w-full p-4 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/60 hover:border-amber-500/50 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 group-hover:bg-amber-500/20 transition-colors">
                  <ArrowUpDown className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">Gemini 日內短炒推介</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    精準技術策略：EMA20 支撐、MACD 金叉、RSI 安全區、爆量確認
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-amber-400 transition-colors" />
              </div>
            </button>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">正宗四階縱深篩選邏輯（透明公開）</p>
                <ol className="list-decimal list-inside mt-1 space-y-0.5">
                  <li>
                    <strong>階段一 · 早盤爆量</strong>
                    ：09:00-10:00 成交量 &gt; 20日均量 1.2 倍，或顯著高開
                  </li>
                  <li>
                    <strong>階段二 · 新聞催化</strong>
                    ：實時匹配 60+ 中英文利好關鍵字
                  </li>
                  <li>
                    <strong>階段三 · 美股聯動</strong>
                    ：對齊前晚美股科技/Crypto 板塊動能
                  </li>
                  <li>
                    <strong>階段四 · 技術共振</strong>
                    ：RSI 安全區 + EMA20 支撐 + MACD 金叉
                  </li>
                </ol>
                {softenerEnabled && (
                  <p className="mt-1.5 text-amber-400 font-medium">
                    ⚡ 降維模式已激活：RSI 下限放寬至 45，利潤要求打 8 折
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── 掃描結果畫面 ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1">
          ← 返回選擇
        </Button>
        <SoftenerToggle
          enabled={softenerEnabled}
          onToggle={() => setSoftenerEnabled((prev) => !prev)}
          compact
        />
      </div>

      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-sm text-muted-foreground">
            正在啟動四階段縱深掃描 70 隻港股...
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            並行抓取數據中，預計 10-15 秒完成
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 盤弱降維試槍開關組件 ──────────────────────────────────────────────────
function SoftenerToggle({
  enabled,
  onToggle,
  compact = false,
}: {
  enabled: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
          enabled
            ? "bg-amber-500/15 border-amber-500/50 text-amber-400 hover:bg-amber-500/25"
            : "bg-muted/40 border-border/50 text-muted-foreground hover:bg-muted/70"
        }`}
      >
        <Zap className={`h-3.5 w-3.5 ${enabled ? "text-amber-400" : ""}`} />
        {enabled ? "降維已激活" : "降維試槍"}
      </button>
    );
  }

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        enabled
          ? "bg-amber-500/10 border-amber-500/40"
          : "bg-muted/30 border-border/50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
              enabled
                ? "bg-amber-500/20 text-amber-400"
                : "bg-muted/60 text-muted-foreground"
            }`}
          >
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <p
              className={`font-medium text-sm ${
                enabled ? "text-amber-400" : ""
              }`}
            >
              🔥 盤弱降維試槍
              {enabled && (
                <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-mono">
                  已激活
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled
                ? "RSI 下限已放寬至 45 · 利潤要求降低 20%"
                : "激活後自動放寬 RSI 至 45，利潤要求打 8 折"}
            </p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${
            enabled ? "bg-amber-500" : "bg-muted-foreground/30"
          }`}
          aria-label="切換盤弱降維試槍"
        >
          <span
            className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
