import dns from 'node:dns';
import dotenv from 'dotenv';

// Force IPv4 to avoid ECONNRESET on Node 17+
// This fixes issues where happy eyeballs algorithm fails causing resets
try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
    console.log('[Network] DNS Order set to ipv4first');
  }
} catch (e) {
  console.warn('[Network] Could not set default result order for DNS', e);
}

dotenv.config();

class LLMClient {
  constructor() {
    this.apiUrl = process.env.UNBOUND_API_URL;
    this.apiKey = process.env.UNBOUND_API_KEY;
    // this.useMock = process.env.USE_MOCK_LLM === 'true'; // Commented out to debug
    this.useMock = false; // FORCED FALSE FOR DEBUGGING

    console.log('--- LLM CLIENT INITIALIZED (Native Fetch) ---');
    console.log(`API URL: ${this.apiUrl}`);
    console.log(`Use Mock: ${this.useMock} (Env: ${process.env.USE_MOCK_LLM})`);

    if (!this.useMock && !this.apiKey) {
      console.warn('⚠️  UNBOUND_API_KEY not set! Set USE_MOCK_LLM=true to use mock responses.');
    }
  }

  async callModel(model, prompt) {
    let usedModel = model;
    let switched = false;

    // Override unsupported or broken models
    if (model === 'gpt-3.5-turbo' || model === 'gpt-4o-mini' || model === 'gemini-1.5-flash' || model === 'fireworks-ai/kimi-k2-instruct-0905') {
      usedModel = 'fireworks-ai/kimi-k2p5';
      switched = true;
      console.log(`[LLM] Automatically switching from ${model} to supported model: fireworks-ai/kimi-k2p5`);
    }

    console.log(`[LLM] Calling model: ${usedModel}`);
    console.log(`[LLM] Prompt length: ${prompt.length} chars`);

    if (this.useMock) {
      console.log('[LLM] Using mock response');
      const content = await this.mockResponse(usedModel, prompt);
      return { content, usedModel, switched };
    }

    // Retry logic for network issues
    const maxRetries = 3;
    let lastError = null;

    // Use streaming to prevent ECONNRESET/Timeouts on long generations
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[LLM] API Call Attempt ${attempt}/${maxRetries} (Streaming)`);

        const response = await fetch(`${this.apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'Connection': 'close'
          },
          body: JSON.stringify({
            model: usedModel,
            messages: [
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2000, // Restored to 2000 since streaming handles timeouts
            stream: true
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP Error ${response.status}: ${errorText}`);
        }

        // Parse SSE Stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep partial line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.substring(6);
              if (dataStr === '[DONE]') continue;

              try {
                const data = JSON.parse(dataStr);
                const content = data.choices?.[0]?.delta?.content || data.choices?.[0]?.text || '';
                fullContent += content;
              } catch (e) {
                // Ignore parse errors for partial json
              }
            }
          }
        }

        if (!fullContent) {
          // Fallback for non-SSE response if any
          throw new Error('No content received from stream');
        }

        console.log(`[LLM] Response received (${fullContent.length} chars)`);
        return { content: fullContent, usedModel, switched };

      } catch (error) {
        lastError = error;
        console.error(`[LLM] Error calling Unbound API (Attempt ${attempt}):`, error.message);

        if (attempt < maxRetries) {
          const delay = 2000 + Math.floor(Math.random() * 1000);
          console.log(`[LLM] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    throw lastError || new Error('Unknown error calling Unbound API');
  }

  mockResponse(model, prompt) {
    // Simulate API delay
    return new Promise((resolve) => {
      setTimeout(() => {
        // Generate contextual responses based on prompt content
        let response = '';

        if (prompt.toLowerCase().includes('calculator')) {
          response = `def calculator():
    """A simple calculator implementation"""
    while True:
        try:
            operation = input("Enter operation (+, -, *, /): ")
            if operation == 'quit':
                break
            num1 = float(input("Enter first number: "))
            num2 = float(input("Enter second number: "))
            
            if operation == '+':
                result = num1 + num2
            elif operation == '-':
                result = num1 - num2
            elif operation == '*':
                result = num1 * num2
            elif operation == '/':
                result = num1 / num2 if num2 != 0 else "Error: Division by zero"
            else:
                result = "Invalid operation"
            
            print(f"Result: {result}")
        except ValueError:
            print("Invalid input")

if __name__ == "__main__":
    calculator()

SUCCESS: Calculator implementation complete`;
        } else if (prompt.toLowerCase().includes('json') || prompt.toLowerCase().includes('data')) {
          response = `{
  "status": "success",
  "data": {
    "items": [
      {"id": 1, "name": "Item 1"},
      {"id": 2, "name": "Item 2"}
    ]
  },
  "message": "Data processed successfully"
}`;
        } else if (prompt.toLowerCase().includes('install') || prompt.toLowerCase().includes('package')) {
          response = `To install the required packages, run:

\`\`\`bash
pip install numpy pandas requests
\`\`\`

These packages are commonly used for:
- numpy: Numerical computations
- pandas: Data manipulation
- requests: HTTP requests

SUCCESS: Package installation instructions provided`;
        } else if (prompt.toLowerCase().includes('test') || prompt.toLowerCase().includes('unit test')) {
          response = `import unittest

class TestCalculator(unittest.TestCase):
    def test_addition(self):
        self.assertEqual(2 + 2, 4)
    
    def test_subtraction(self):
        self.assertEqual(5 - 3, 2)
    
    def test_multiplication(self):
        self.assertEqual(3 * 4, 12)
    
    def test_division(self):
        self.assertEqual(10 / 2, 5)

if __name__ == '__main__':
    unittest.main()

SUCCESS: Unit tests written`;
        } else {
          // Generic response with SUCCESS marker
          response = `I understand you want me to: ${prompt.substring(0, 100)}...

Here's my response addressing your request:

1. I've analyzed the requirements
2. Generated the appropriate output
3. Ensured quality standards are met

SUCCESS: Task completed successfully`;
        }

        console.log(`[LLM] Mock response generated (${response.length} chars)`);
        resolve(response);
      }, 1500); // Simulate API latency
    });
  }

  // Evaluate completion criteria
  async evaluateCriteria(output, criteria) {
    console.log(`[LLM] Evaluating criteria:`, criteria);

    const result = {
      passed: false,
      reason: '',
      details: {}
    };

    try {
      switch (criteria.type) {
        case 'contains_text':
          result.passed = output.toLowerCase().includes(criteria.value.toLowerCase());
          result.reason = result.passed
            ? `Output contains "${criteria.value}"`
            : `Output missing "${criteria.value}"`;
          break;

        case 'regex_match':
          const regex = new RegExp(criteria.value);
          result.passed = regex.test(output);
          result.reason = result.passed
            ? `Output matches pattern: ${criteria.value}`
            : `Output doesn't match pattern: ${criteria.value}`;
          break;

        case 'valid_json':
          try {
            JSON.parse(output);
            result.passed = true;
            result.reason = 'Output is valid JSON';
          } catch (e) {
            result.passed = false;
            result.reason = `Invalid JSON: ${e.message}`;
          }
          break;

        case 'contains_code':
          result.passed = output.includes('```') || output.includes('def ') || output.includes('function ');
          result.reason = result.passed
            ? 'Output contains code blocks'
            : 'Output missing code blocks';
          break;

        case 'min_length':
          result.passed = output.length >= criteria.value;
          result.reason = result.passed
            ? `Output length ${output.length} >= ${criteria.value}`
            : `Output too short: ${output.length} < ${criteria.value}`;
          break;

        case 'llm_judge':
          // Use another LLM call to judge if criteria is met
          const judgePrompt = `Evaluate if the following output meets this criteria: "${criteria.value}"

Output to evaluate:
${output}

Respond with only "YES" if it meets the criteria, or "NO" if it doesn't, followed by a brief reason.`;

          const judgeResult = await this.callModel('fireworks-ai/kimi-k2p5', judgePrompt);
          const judgeResponse = judgeResult.content;
          result.passed = judgeResponse.toUpperCase().startsWith('YES');
          result.reason = judgeResponse;
          break;

        default:
          result.passed = false;
          result.reason = `Unknown criteria type: ${criteria.type}`;
      }
    } catch (error) {
      result.passed = false;
      result.reason = `Error evaluating criteria: ${error.message}`;
    }

    console.log(`[LLM] Criteria evaluation:`, result);
    return result;
  }
}

export default new LLMClient();