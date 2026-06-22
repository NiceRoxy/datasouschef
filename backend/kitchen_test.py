import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# We need both API keys. Let's do a quick check
if not os.getenv("GEMINI_API_KEY"):
    print("ERROR: GEMINI_API_KEY is not set in your .env file.")
    exit(1)
if not os.getenv("TAVILY_API_KEY"):
    print("ERROR: TAVILY_API_KEY is not set in your .env file.")
    print("Please get one from https://tavily.com and add it to .env")
    exit(1)

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_tavily import TavilySearch
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage

def main():
    print("Initializing Gemini 3.1 Pro...")
    # Initialize the LLM
    llm = ChatGoogleGenerativeAI(
        model="gemini-3.1-pro-preview",
        temperature=0,
    )

    print("Initializing Tavily Search Tool...")
    # Initialize the Tavily Search tool
    # max_results controls how many search results Tavily fetches
    search_tool = TavilySearch(max_results=3)
    tools = [search_tool]

    print("Creating the LangGraph Agent...")
    # Create the agent using LangGraph's prebuilt ReAct agent
    # This replaces the older create_tool_calling_agent
    agent_executor = create_agent(llm, tools)

    # Test Query
    query = "What are the biggest recent news stories about artificial intelligence today?"
    print(f"\nRunning test query: '{query}'\n")
    
    # Run the agent
    try:
        # The agent expects a list of messages. We pass a HumanMessage.
        response = agent_executor.invoke({"messages": [HumanMessage(content=query)]})
        
        # The response is a dict with the updated state. 
        # The final answer is typically the content of the last AI message.
        final_message = response["messages"][-1]
        
        print("\n=== Final Answer ===")
        print(final_message.content)
    except Exception as e:
        print(f"\nAn error occurred during execution: {e}")

if __name__ == "__main__":
    main()
