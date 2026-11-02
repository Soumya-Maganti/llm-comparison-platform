import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
} from "@mui/material";
import { browserId, request, type Comparison, type Leaderboard } from "./api";
import ResponseCard from "./ResponseCard";
import "./style.css";

const theme = createTheme({
  palette: {
    primary: { main: "#176b58" },
    secondary: { main: "#c27c30" },
    background: { default: "#f5f6f4", paper: "#ffffff" },
    text: { primary: "#192c39", secondary: "#63717a" },
  },
  typography: {
    fontFamily: 'Inter, "Segoe UI", sans-serif',
    h3: { fontWeight: 750, letterSpacing: "-1.5px" },
    h5: { fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 650 },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { defaultProps: { elevation: 0, variant: "outlined" } },
  },
});

function App() {
  const [identity] = useState(() => {
    try {
      return browserId();
    } catch {
      return null;
    }
  });
  const [prompt, setPrompt] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [history, setHistory] = useState<Comparison[]>([]);
  const [board, setBoard] = useState<Leaderboard>({
    total_votes: 0,
    models: [],
  });
  const [loading, setLoading] = useState(false);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [more, setMore] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function refresh() {
    if (!identity) return;
    await Promise.all([
      request<Comparison[]>(`/history?browser_id=${identity}`).then((rows) => {
        setHistory(rows);
        setMore(rows.length === 20);
      }),
      request<Leaderboard>("/leaderboard").then(setBoard),
    ]);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [identity]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!identity || !prompt.trim() || loading || voting || historyLoading)
      return;
    setLoading(true);
    setError("");
    setNotice("");
    setComparison(null);
    try {
      const result = await request<Comparison>("/comparisons", {
        prompt,
        browser_id: identity,
      });
      setComparison(result);
      setHistory((previous) => [result, ...previous]);
      await refresh().catch(() =>
        setNotice(
          "Comparison saved. Refresh to update history and leaderboard.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function vote(response_id: string) {
    if (!comparison || voting || loading || historyLoading) return;
    setVoting(true);
    setError("");
    try {
      const updated = await request<Comparison>(
        `/comparisons/${comparison.id}/votes`,
        { browser_id: identity, response_id },
      );
      setComparison(updated);
      setHistory((previous) =>
        previous.map((row) => (row.id === updated.id ? updated : row)),
      );
      setNotice("Vote recorded. Thank you for contributing.");
      await refresh().catch(() =>
        setNotice("Vote saved. Refresh to update the leaderboard."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVoting(false);
    }
  }
  async function loadMore() {
    if (historyLoading || loading || voting) return;
    setHistoryLoading(true);
    try {
      const rows = await request<Comparison[]>(
        `/history?browser_id=${identity}&offset=${history.length}`,
      );
      setHistory((previous) => [...previous, ...rows]);
      setMore(rows.length === 20);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }
  const canVote =
    comparison?.responses.length === 2 &&
    comparison.responses.every((r) => !r.error && r.text);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar
        position="static"
        elevation={0}
        sx={{ bgcolor: "#192f3f", color: "white" }}
      >
        <Toolbar sx={{ maxWidth: 1280, width: "100%", mx: "auto", gap: 1.5 }}>
          <Box className="brand-mark">⇄</Box>
          <Typography fontWeight={700}>LLM Comparison Platform</Typography>
          <Chip
            label="GEMINI LAB"
            size="small"
            sx={{
              ml: "auto",
              color: "#b7ddcd",
              bgcolor: "#294a51",
              letterSpacing: 1,
            }}
          />
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Typography
          variant="overline"
          color="primary"
          fontWeight={800}
          letterSpacing={2}
        >
          TWO MODELS. ONE PROMPT.
        </Typography>
        <Typography
          variant="h3"
          sx={{ fontSize: { xs: 34, md: 40, lg: 48 }, mt: 1 }}
        >
          Better answers start with a comparison.
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 2, mb: 4, maxWidth: 650 }}>
          Explore how two Gemini models think. Compare their responses, choose
          your favorite, and see how the community votes.
        </Typography>
        {!identity && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Browser storage is unavailable. Enable local storage to save your
            anonymous identity and use comparisons.
          </Alert>
        )}
        {error && (
          <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert
            severity="success"
            onClose={() => setNotice("")}
            sx={{ mb: 2 }}
          >
            {notice}
          </Alert>
        )}
        <Paper component="form" onSubmit={submit} sx={{ p: { xs: 2, md: 3 } }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            mb={2}
          >
            <Typography variant="h6" fontWeight={700}>
              Your prompt
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label="Same prompt · two models"
            />
          </Stack>
          <TextField
            label="What would you like to explore?"
            placeholder="Explain a complex concept, solve a problem, or ask for a creative idea…"
            fullWidth
            multiline
            minRows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={loading}
            slotProps={{ htmlInput: { maxLength: 12000 } }}
          />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ sm: "center" }}
            justifyContent="space-between"
            gap={2}
            mt={2}
          >
            <Typography variant="caption" color="text.secondary">
              {prompt.length.toLocaleString()} / 12,000 characters · Prompts are
              sent to Google Gemini
            </Typography>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={
                loading ||
                voting ||
                historyLoading ||
                !identity ||
                !prompt.trim()
              }
              startIcon={
                loading ? (
                  <CircularProgress size={18} color="inherit" />
                ) : undefined
              }
            >
              {loading ? "Comparing models…" : "Compare responses →"}
            </Button>
          </Stack>
        </Paper>
        {loading && (
          <Box role="status" aria-live="polite" sx={{ my: 3 }}>
            <LinearProgress />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Both models are working on your prompt. This can take up to a
              minute.
            </Typography>
          </Box>
        )}
        {comparison && (
          <Box sx={{ mt: 4 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              mb={2}
            >
              <Typography variant="h5">The comparison</Typography>
              <Chip
                size="small"
                label={
                  comparison.voted_response_id
                    ? "Vote recorded"
                    : "Choose the better answer"
                }
              />
            </Stack>
            <Paper sx={{ p: 2, mb: 2, bgcolor: "#edf3ef" }}>
              <Typography variant="overline">PROMPT</Typography>
              <Typography
                sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >
                {comparison.prompt}
              </Typography>
            </Paper>
            <Box className="responses">
              {comparison.responses.map((response, i) => (
                <ResponseCard
                  key={response.id}
                  response={response}
                  accent={i === 0 ? "#176b58" : "#c27c30"}
                  selected={comparison.voted_response_id === response.id}
                  votingDisabled={
                    !canVote ||
                    !!comparison.voted_response_id ||
                    voting ||
                    loading ||
                    historyLoading
                  }
                  onVote={() => vote(response.id)}
                />
              ))}
            </Box>
            {!canVote && (
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Voting is available when both models return a response.
              </Typography>
            )}
          </Box>
        )}
        <Box className="bottom-grid" sx={{ mt: 4 }}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" mb={1}>
              <Typography variant="h5">Leaderboard</Typography>
              <Chip size="small" label={`${board.total_votes} votes`} />
            </Stack>
            <Typography color="text.secondary" variant="body2" mb={3}>
              Community preference across all comparisons
            </Typography>
            {!board.models.length && (
              <Typography color="text.secondary">
                No rankings available yet.
              </Typography>
            )}
            {board.models.map((model, i) => (
              <Box key={model.model} mb={3}>
                <Stack direction="row" justifyContent="space-between" gap={1}>
                  <Typography
                    fontWeight={650}
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    {i + 1}. {model.model}
                  </Typography>
                  <Typography whiteSpace="nowrap">
                    {model.vote_percentage}%
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={model.vote_percentage}
                  sx={{ height: 6, borderRadius: 3, my: 1, bgcolor: "#e9efeb" }}
                />
                <Typography variant="caption" color="text.secondary">
                  {model.wins} wins
                </Typography>
              </Box>
            ))}
            <Typography variant="caption" color="text.secondary">
              Percentages represent share of all votes, not objective model
              quality.
            </Typography>
          </Paper>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5">Your history</Typography>
            <Typography
              color="text.secondary"
              variant="body2"
              sx={{ mt: 1, mb: 2 }}
            >
              Saved for this browser. Pick a comparison to revisit.
            </Typography>
            {!history.length && (
              <Box
                sx={{
                  py: 4,
                  textAlign: "center",
                  bgcolor: "#f7f8f6",
                  borderRadius: 2,
                }}
              >
                <Typography fontWeight={650}>
                  Your next discovery starts above
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Completed comparisons will appear here.
                </Typography>
              </Box>
            )}
            <Stack spacing={1}>
              {history.map((row) => (
                <Button
                  key={row.id}
                  disabled={loading || voting}
                  onClick={() => {
                    setComparison(row);
                    setNotice("");
                  }}
                  variant="text"
                  sx={{
                    display: "block",
                    textAlign: "left",
                    p: 1.5,
                    bgcolor: comparison?.id === row.id ? "#edf3ef" : "#f7f8f6",
                    color: "text.primary",
                  }}
                >
                  <Typography noWrap fontWeight={600}>
                    {row.prompt}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(row.created_at).toLocaleString()} ·{" "}
                    {row.voted_response_id ? "Voted" : "Not voted"}
                  </Typography>
                </Button>
              ))}
            </Stack>
            {more && history.length > 0 && (
              <Button
                onClick={loadMore}
                disabled={historyLoading || loading || voting}
                sx={{ mt: 2 }}
              >
                {historyLoading ? "Loading…" : "Load older comparisons"}
              </Button>
            )}
          </Paper>
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          component="footer"
          sx={{ mt: 4, textAlign: "center" }}
        >
          Built for curiosity. Responses are AI-generated and may contain
          errors. History follows this browser’s anonymous ID.
        </Typography>
      </Container>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
