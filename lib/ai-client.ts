import { config } from './config';
import {
  NLPJourneyIntent,
  NLP_SYSTEM_PROMPT,
  createDefaultIntent,
  isValidIntentType,
} from '@/lib/schemas/nlp-response';

interface AzureOpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AzureOpenAIRequest {
  messages: AzureOpenAIMessage[];
  temperature?: number;
  max_completion_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  response_format?: { type: 'json_object' };
}

interface AzureOpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: AzureOpenAIMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class AzureAIClient {
  private apiUrl: string;
  private apiKey: string;
  private transcriptionUrl: string;

  constructor() {
    this.apiUrl = config.azure.apiUrl;
    this.apiKey = config.azure.apiKey;
    this.transcriptionUrl = config.azure.transcriptionUrl;

    if ((!this.apiUrl || !this.apiKey) && process.env.NODE_ENV !== 'test') {
      console.warn('Azure OpenAI configuration is missing');
    }

    if (!this.transcriptionUrl && process.env.NODE_ENV !== 'test') {
      console.warn('Azure OpenAI transcription endpoint is missing');
    }
  }

  async parseJourneyIntent(userQuery: string): Promise<NLPJourneyIntent> {
    if (!this.apiUrl || !this.apiKey) {
      throw new Error('Azure OpenAI is not configured properly');
    }

    try {
      const requestBody: AzureOpenAIRequest = {
        messages: [
          {
            role: 'system',
            content: NLP_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userQuery,
          },
        ],
        max_completion_tokens: 500,
        response_format: { type: 'json_object' },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Azure OpenAI API error: ${response.status} - ${
            errorData.error?.message || response.statusText
          }`
        );
      }

      const data: AzureOpenAIResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from Azure OpenAI');
      }

      const messageContent = data.choices[0].message.content;
      
      // Parse the JSON response
      const intent = JSON.parse(messageContent) as NLPJourneyIntent;

      // Validate the response
      if (!isValidIntentType(intent.type)) {
        throw new Error(`Invalid intent type: ${intent.type}`);
      }

      // Ensure rawQuery is set
      if (!intent.rawQuery) {
        intent.rawQuery = userQuery;
      }

      return intent;
    } catch (error) {
      console.error('Error parsing journey intent:', error);
      
      // Return a default intent on error
      return createDefaultIntent(userQuery);
    }
  }

  async transcribeAudio(
    audioBuffer: ArrayBuffer,
    filename: string,
    mimeType: string,
    prompt?: string
  ): Promise<string> {
    if (!this.transcriptionUrl || !this.apiKey) {
      throw new Error('Azure OpenAI transcription is not configured properly');
    }

    try {
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer], { type: mimeType });

      formData.append('file', audioBlob, filename);
      formData.append('response_format', 'json');
      formData.append('language', 'en');
      formData.append('temperature', '0');

      if (prompt) {
        formData.append('prompt', prompt);
      }

      const response = await fetch(this.transcriptionUrl, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Azure OpenAI transcription error: ${response.status} - ${
            errorData.error?.message || response.statusText
          }`
        );
      }

      const data = await response.json();

      if (!data?.text) {
        throw new Error('No transcription text returned');
      }

      return data.text as string;
    } catch (error) {
      console.error('Error transcribing audio:', error);
      throw error;
    }
  }

  async generateAccessibleDescription(journey: any): Promise<string> {
    if (!this.apiUrl || !this.apiKey) {
      return 'Journey description not available';
    }

    try {
      const requestBody: AzureOpenAIRequest = {
        messages: [
          {
            role: 'system',
            content: `You are a helpful TFL assistant. Create a clear, concise, and accessible journey description.
Focus on:
- Step-by-step instructions
- Platform/stop information
- Walking directions between stations
- Any accessibility features
Keep it under 200 words and use simple language.`,
          },
          {
            role: 'user',
            content: `Describe this journey: ${JSON.stringify(journey)}`,
          },
        ],
        max_completion_tokens: 2000,
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error('Failed to generate description');
      }

      const data: AzureOpenAIResponse = await response.json();
      return data.choices[0]?.message.content || 'Journey description not available';
    } catch (error) {
      console.error('Error generating accessible description:', error);
      return 'Journey description not available';
    }
  }

  async clarifyAmbiguousQuery(
    originalQuery: string,
    ambiguities: string[]
  ): Promise<string[]> {
    if (!this.apiUrl || !this.apiKey) {
      return [];
    }

    try {
      const requestBody: AzureOpenAIRequest = {
        messages: [
          {
            role: 'system',
            content: `You are a TFL assistant helping to clarify ambiguous journey queries.
Generate 2-3 clarifying questions to help understand the user's intent.
Return a JSON array of strings, each being a short question.`,
          },
          {
            role: 'user',
            content: `Original query: "${originalQuery}"
Ambiguities: ${ambiguities.join(', ')}`,
          },
        ],
        max_completion_tokens: 200,
        response_format: { type: 'json_object' },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error('Failed to generate clarifying questions');
      }

      const data: AzureOpenAIResponse = await response.json();
      const content = data.choices[0]?.message.content || '{"questions":[]}';
      const parsed = JSON.parse(content);
      return parsed.questions || [];
    } catch (error) {
      console.error('Error generating clarifying questions:', error);
      return [];
    }
  }

  async parseServiceStatusQuery(query: string): Promise<{
    lines?: string[];
    stations?: string[];
    mode?: string;
  }> {
    if (!this.apiUrl || !this.apiKey) {
      return {};
    }

    try {
      const requestBody: AzureOpenAIRequest = {
        messages: [
          {
            role: 'system',
            content: `Extract transport line names, station names, and transport modes from service status queries.
Return JSON with:
- lines: array of line names (e.g., ["Central", "Northern"])
- stations: array of station names
- mode: single mode if specified (tube, bus, dlr, overground, tram)
Be specific with line names. For example, "Central Line" -> "Central".`,
          },
          {
            role: 'user',
            content: query,
          },
        ],
        max_completion_tokens: 200,
        response_format: { type: 'json_object' },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error('Failed to parse service status query');
      }

      const data: AzureOpenAIResponse = await response.json();
      const content = data.choices[0]?.message.content || '{}';
      return JSON.parse(content);
    } catch (error) {
      console.error('Error parsing service status query:', error);
      return {};
    }
  }

  // Utility method to enhance location names for better TFL search
  async enhanceLocationName(locationName: string): Promise<string> {
    if (!this.apiUrl || !this.apiKey) {
      return locationName;
    }

    try {
      const requestBody: AzureOpenAIRequest = {
        messages: [
          {
            role: 'system',
            content: `You are a London transport expert. Given a user-supplied location in London, return the most accurate, human-readable location name.
Keep the response as close as possible to the user input when it is already clear.
Expand abbreviations or shorthand to their full London forms when needed (e.g. "IC White City" -> "Imperial College London White City Campus").
Do not limit responses to transport stations; you may return campuses, landmarks, or neighbourhood names when that best reflects the user's intent.
Return a single line of text with no extra commentary.`,
          },
          {
            role: 'user',
            content: locationName,
          },
        ],
        max_completion_tokens: 50,
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return locationName;
      }

      const data: AzureOpenAIResponse = await response.json();
      return data.choices[0]?.message.content.trim() || locationName;
    } catch (error) {
      console.error('Error enhancing location name:', error);
      return locationName;
    }
  }
}

// Create and export singleton instance
export const aiClient = new AzureAIClient();

// Export class for testing
export { AzureAIClient };
