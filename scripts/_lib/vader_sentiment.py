#!/usr/bin/env python3
"""Read a JSON array of strings from stdin, output a JSON array of VADER scores."""
import json
import sys
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

texts = json.load(sys.stdin)
analyzer = SentimentIntensityAnalyzer()
results = [analyzer.polarity_scores(t) for t in texts]
json.dump(results, sys.stdout)
