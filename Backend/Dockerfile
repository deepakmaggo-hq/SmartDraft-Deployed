

FROM python:3.11-slim

Set the working directory inside the container

WORKDIR /app

Copy only the requirements first (to leverage Docker caching)

COPY requirements.txt .

Install dependencies

RUN pip install --no-cache-dir -r requirements.txt

Copy the rest of your backend code into the container

COPY . .

Expose the port FastAPI runs on

EXPOSE 8000

Command to run the application (Must bind to 0.0.0.0 for Cloud platforms)

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
