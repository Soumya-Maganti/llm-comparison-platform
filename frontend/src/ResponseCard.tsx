import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { ModelResponse } from "./api";

type Props = {
  response: ModelResponse;
  accent: string;
  selected: boolean;
  votingDisabled: boolean;
  onVote: () => void;
};

function ResponseText({ text }: { text: string }) {
  return text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).map((part, index) => {
    if (!/^```[^\n]*\n/.test(part)) return <span key={index}>{part}</span>;
    const code = part.slice(part.indexOf("\n") + 1).replace(/```$/, "");
    return (
      <Box component="pre" className="response-code" key={index}>
        <code>{code}</code>
      </Box>
    );
  });
}

export default function ResponseCard({
  response,
  accent,
  selected,
  votingDisabled,
  onVote,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const contentId = `response-content-${response.id}`;

  return (
    <Paper
      className="response-card"
      sx={{ p: 3, minWidth: 0, borderTop: `3px solid ${accent}` }}
    >
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
        <Typography
          fontWeight={750}
          sx={{ overflowWrap: "anywhere", minWidth: 0 }}
        >
          {response.model}
        </Typography>
        <Chip
          size="small"
          label={`${(response.latency_ms / 1000).toFixed(2)}s`}
          sx={{ ml: "auto" }}
        />
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Box
        id={contentId}
        role="region"
        aria-label={`Response from ${response.model}`}
        tabIndex={0}
        className={`response-content${expanded ? " response-content-expanded" : ""}`}
        sx={{
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: 3,
            borderRadius: 1,
          },
        }}
      >
        {response.error ? (
          <Alert severity="warning">{response.error}</Alert>
        ) : (
          <Typography component="div" className="response-text">
            <ResponseText text={response.text} />
          </Typography>
        )}
      </Box>
      <Stack spacing={1} className="response-controls">
        <Button
          size="small"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={`${expanded ? "Collapse" : "Expand"} response from ${response.model}`}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? "Collapse response" : "Expand response"}
        </Button>
        <Button
          variant={selected ? "contained" : "outlined"}
          disabled={votingDisabled}
          onClick={onVote}
        >
          {selected ? "✓ Your preferred response" : "Vote for this response"}
        </Button>
      </Stack>
    </Paper>
  );
}
